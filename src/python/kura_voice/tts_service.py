"""Text to speech with the Style-Bert-VITS2 fork (style-bert-vits2-mk).

The main process parses the control tags and sends ready-made pieces:
  {"kind": "speech", "parts": [...], "rate": 1.0, "pitch": 0.0, "volume": 0.0}
  {"kind": "silence", "ms": 500}
Each speech part is either plain text ({"text": ...}), a Japanese accent override
({"surface": ..., "kataTone": [[mora, tone], ...], "reading": ...}) or an English IPA override
({"surface": ..., "words": [[ARPAbet, ...], ...]}).
"""

from __future__ import annotations

import math
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from kura_voice import runtime
from kura_voice.protocol import Context, KuraError

SILENT_DB = -200.0
# Every synthesized clip comes back normalised to full scale; keep some headroom.
OUTPUT_GAIN = 10 ** (-1.0 / 20)

_model: Any = None
_model_key: Optional[Tuple[str, str]] = None
_prepared = False


def _prepare() -> None:
    global _prepared
    if _prepared:
        return
    import nltk
    from loguru import logger

    # The library logs (including the whole input text) to stdout; keep them on stderr.
    logger.remove()
    logger.add(sys.stderr, level="INFO", format="{time:HH:mm:ss} | {level} | {message}")

    # NLTK data comes with the app's downloads; a missing file must not be fetched from the network.
    def blocked(*args: Any, **kwargs: Any) -> bool:
        raise KuraError("NLTK_DATA_MISSING")

    nltk.download = blocked
    _prepared = True


def _language(code: str) -> Any:
    from style_bert_vits2.constants import Languages

    languages = {"ja": Languages.JP, "en": Languages.EN}
    if code not in languages:
        raise KuraError("TTS_LANGUAGE_UNSUPPORTED", code)
    return languages[code]


def _load_bert(language: str, bert_dirs: Dict[str, str]) -> None:
    """Load the BERT model of the language from its folder in the model directory (once)."""
    from style_bert_vits2.nlp import bert_models

    lang = _language(language)
    if not bert_models.is_tokenizer_loaded(lang):
        bert_models.load_tokenizer(lang, bert_dirs[language])
    if not bert_models.is_model_loaded(lang):
        bert_models.load_model(lang, bert_dirs[language])


def _load_model(params: dict, device: str) -> Any:
    global _model, _model_key
    from style_bert_vits2.tts_model import TTSModel

    model = params["model"]
    key = (model["weights"], device)
    if _model is not None and _model_key == key:
        return _model
    if _model is not None:
        _model.unload()
    _model = TTSModel(
        model_path=Path(model["weights"]),
        config_path=Path(model["config"]),
        style_vec_path=Path(model["style"]),
        device=device,
    )
    _model_key = key
    return _model


def _db_to_gain(db: float) -> float:
    if db <= SILENT_DB:
        return 0.0
    return 10 ** (db / 20)


def _japanese_given(parts: List[dict], use_jp_extra: bool) -> Tuple[str, List[str], List[int], str]:
    """Phones and tones for a piece containing accent overrides (Tokyo-style accent notation)."""
    from style_bert_vits2.nlp.japanese.g2p_utils import g2kata_tone, kata_tone2phone_tone
    from style_bert_vits2.nlp.japanese.normalizer import normalize_text

    kata_tone: List[Tuple[str, int]] = []
    surface_text = []
    reading_text = []
    for part in parts:
        if "kataTone" in part:
            kata_tone.extend((str(mora), int(tone)) for mora, tone in part["kataTone"])
            surface_text.append(part["surface"])
            reading_text.append(part["reading"])
            continue
        normalized = normalize_text(part["text"])
        if normalized.strip():
            kata_tone.extend(g2kata_tone(normalized))
        surface_text.append(part["text"])
        reading_text.append(part["text"])
    phone_tone = kata_tone2phone_tone(kata_tone)
    phones = [phone for phone, _ in phone_tone]
    tones = [tone for _, tone in phone_tone]
    if not use_jp_extra:
        phones = ["n" if phone == "N" else phone for phone in phones]
    return "".join(surface_text), phones, tones, "".join(reading_text)


def _english_overrides(parts: List[dict]) -> Tuple[str, Dict[str, list]]:
    """Plain text plus pronunciation overrides injected into the English dictionary."""
    from style_bert_vits2.constants import Languages
    from style_bert_vits2.nlp import bert_models

    tokenizer = bert_models.load_tokenizer(Languages.EN)
    overrides: Dict[str, list] = {}
    texts = []
    for part in parts:
        if "words" not in part:
            texts.append(part["text"])
            continue
        surface_words = part["surface"].split()
        for word, phones in zip(surface_words, part["words"]):
            pieces = [piece for piece in tokenizer.tokenize(word) if piece not in ("\u2581",)]
            if len(pieces) != 1:
                raise KuraError("IPA_WORD_SPLIT", word)
            overrides[pieces[0].lstrip("\u2581").upper()] = [list(phones)]
        texts.append(part["surface"])
    return " ".join(text.strip() for text in texts if text.strip()), overrides


def _synthesize_piece(piece: dict, params: dict, model: Any) -> Any:
    import numpy as np

    language = params["language"]
    use_jp_extra = params["engine"] == "jp-extra"
    base = params["params"]
    rate = max(0.05, float(base["speed"]) * float(piece["rate"]))
    pitch_scale = float(base["pitchScale"]) * (2 ** (float(piece["pitch"]) / 12))
    kwargs = dict(
        language=_language(language),
        speaker_id=int(base["speakerId"]),
        sdp_ratio=float(base["sdpRatio"]),
        noise=float(base["noise"]),
        noise_w=float(base["noiseW"]),
        length=1.0 / rate,
        line_split=False,
        style=str(base["style"]),
        style_weight=float(base["styleWeight"]),
        pitch_scale=pitch_scale,
        intonation_scale=float(base["intonationScale"]),
    )
    parts = piece["parts"]
    if language == "ja" and any("kataTone" in part for part in parts):
        from style_bert_vits2.nlp import InvalidPhoneError

        text, phones, tones, reading = _japanese_given(parts, use_jp_extra)
        try:
            _rate, audio = model.infer(text=text, given_phone=phones, given_tone=tones, **kwargs)
        except InvalidPhoneError:
            # The surface text could not be aligned with the given reading; use the reading itself.
            _rate, audio = model.infer(text=reading, given_phone=phones, given_tone=tones, **kwargs)
    elif language == "en" and any("words" in part for part in parts):
        from style_bert_vits2.nlp.english import g2p as english_g2p

        text, overrides = _english_overrides(parts)
        saved = {word: english_g2p.eng_dict.get(word) for word in overrides}
        english_g2p.eng_dict.update(overrides)
        try:
            _rate, audio = model.infer(text=text, **kwargs)
        finally:
            for word, value in saved.items():
                if value is None:
                    english_g2p.eng_dict.pop(word, None)
                else:
                    english_g2p.eng_dict[word] = value
    else:
        text = "".join(part["text"] for part in parts)
        _rate, audio = model.infer(text=text, **kwargs)
    samples = audio.astype(np.float32) / 32768.0
    return samples * _db_to_gain(float(piece["volume"])) * OUTPUT_GAIN


def _speakable(piece: dict) -> bool:
    for part in piece["parts"]:
        # Plain text, or the surface text of an accent / pronunciation override
        text = part["text"] if "text" in part else part["surface"]
        if any(char.isalnum() for char in text):
            return True
    return False


def _synthesize_segment(segment: dict, params: dict, model: Any, sample_rate: int) -> Any:
    import numpy as np

    chunks = []
    for piece in segment["pieces"]:
        if piece["kind"] == "silence":
            chunks.append(np.zeros(int(sample_rate * float(piece["ms"]) / 1000.0), dtype=np.float32))
        elif _speakable(piece):
            chunks.append(_synthesize_piece(piece, params, model))
    if not chunks:
        return np.zeros(0, dtype=np.float32)
    return np.concatenate(chunks).astype(np.float32)


def _write_wav(path: str, samples: Any, sample_rate: int) -> None:
    import soundfile

    soundfile.write(path, samples, sample_rate, subtype="FLOAT")


def rpc_synthesize(params: dict, context: Context) -> dict:
    """Synthesize every segment into its own WAV file and report the durations."""
    _prepare()

    def run(device: str) -> List[dict]:
        _load_bert(params["language"], params["berts"])
        model = _load_model(params, device)
        sample_rate = int(model.hyper_parameters.data.sampling_rate)
        results = []
        segments = params["segments"]
        for index, segment in enumerate(segments):
            samples = _synthesize_segment(segment, params, model, sample_rate)
            path = os.path.join(params["outputDir"], f"{segment['id']}.wav")
            _write_wav(path, samples, sample_rate)
            results.append({"id": segment["id"], "path": path, "duration": len(samples) / sample_rate})
            context.progress((index + 1) / len(segments), str(segment["id"]))
        return results

    return {"segments": runtime.run_with_cpu_fallback(run, unload)}


def rpc_assemble(params: dict, context: Context) -> dict:
    """Place clips at their start times (seconds) and mix them into one file."""
    import numpy as np
    import soundfile

    sample_rate = int(params["sampleRate"])
    placements = params["placements"]
    clips = []
    length = int(math.ceil(float(params["minDuration"]) * sample_rate))
    for placement in placements:
        data, rate = soundfile.read(placement["path"], dtype="float32", always_2d=False)
        if data.ndim > 1:
            data = data.mean(axis=1)
        if rate != sample_rate:
            raise KuraError("SAMPLE_RATE_MISMATCH", f"{rate} != {sample_rate}")
        start = int(round(float(placement["start"]) * sample_rate))
        clips.append((start, data))
        length = max(length, start + len(data))
    mix = np.zeros(length, dtype=np.float32)
    for start, data in clips:
        mix[start : start + len(data)] += data
    peak = float(np.max(np.abs(mix))) if len(mix) else 0.0
    if peak > 1.0:
        mix /= peak
    _write_wav(params["output"], mix, sample_rate)
    return {"path": params["output"], "duration": length / sample_rate}


def rpc_inspect_style_vectors(params: dict, context: Context) -> dict:
    """Read style_vectors.npy as a plain numeric array (no pickle) and store a clean copy."""
    import numpy as np

    path = params["path"]
    try:
        vectors = np.load(path, allow_pickle=False)
        safe = True
    except Exception as error:
        if not params.get("allowUnsafe"):
            return {"safe": False, "detail": f"{type(error).__name__}: {error}"[:2000]}
        # The user accepted the risk: pickle data inside the file may run code while loading.
        vectors = np.load(path, allow_pickle=True)
        safe = False
    vectors = np.asarray(vectors, dtype=np.float32)
    if vectors.ndim != 2:
        raise KuraError("INVALID_TTS_MODEL", "style vectors must be a 2-D array")
    output = params.get("output")
    if output:
        np.save(output, vectors, allow_pickle=False)
    return {"safe": safe, "shape": list(vectors.shape)}


def unload() -> None:
    global _model, _model_key
    from style_bert_vits2.nlp import bert_models

    if _model is not None:
        _model.unload()
    _model = None
    _model_key = None
    bert_models.unload_all_models()
    runtime.release_memory()
