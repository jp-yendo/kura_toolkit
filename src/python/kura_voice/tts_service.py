"""Text to speech with the Style-Bert-VITS2 fork (style-bert-vits2-mk).

The main process parses the control tags and sends ready-made pieces:
  {"kind": "speech", "parts": [...], "rate": 1.0, "pitch": 0.0, "volume": 0.0}
  {"kind": "silence", "ms": 500}
Each speech part is either plain text ({"text": ...}), a Japanese accent override
({"surface": ..., "kataTone": [[mora, tone], ...], "reading": ...}), an English IPA override
({"surface": ..., "words": [[ARPAbet, ...], ...]}) or a Chinese pinyin override
({"surface": ..., "pinyin": [[syllable, tone], ...]}).
"""

from __future__ import annotations

import math
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from kura_voice import runtime
from kura_voice.protocol import Context, KuraError
# The silence handling requests are shared by every component (the worker looks up rpc_<method> in this module)
from kura_voice.silence import rpc_detect_silence, rpc_edit_silence  # noqa: F401

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
    runtime.patch_nltk_zip_lookup()
    _prepared = True


def _language(code: str) -> Any:
    from style_bert_vits2.constants import Languages

    languages = {"ja": Languages.JP, "en": Languages.EN, "zh": Languages.ZH}
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


def _chinese_given(parts: List[dict]) -> Tuple[str, List[str], List[int]]:
    """Phones and tones for a piece containing pinyin overrides.

    The whole text is converted as usual, then the phones and tones of the overridden characters are
    replaced. Every syllable maps to two phones, so the length (and the alignment with the text) stays
    the same. The overridden characters are Han characters only, which normalization keeps one for one
    (a few are replaced by another character, such as 嗯 -> 恩), so their position in the normalized text is
    the normalized length of the parts before them.
    """
    from style_bert_vits2.constants import Languages
    from style_bert_vits2.nlp import clean_text
    from style_bert_vits2.nlp.chinese import g2p as chinese_g2p
    from style_bert_vits2.nlp.chinese.normalizer import normalize_text

    # The syllable -> phones table of the library (a module-level name starting with "__")
    syllable_phones: Dict[str, str] = getattr(chinese_g2p, "__PINYIN_TO_SYMBOL_MAP")
    text = "".join(part["text"] if "text" in part else part["surface"] for part in parts)
    normalized, phones, tones, word2ph = clean_text(text, Languages.ZH)[:4]
    # position in the normalized text -> (character, syllable, tone)
    overrides: Dict[int, Tuple[str, str, int]] = {}
    offset = 0
    for part in parts:
        if "pinyin" in part:
            characters = part["surface"].strip()
            for index, (syllable, tone) in enumerate(part["pinyin"]):
                overrides[offset + index] = (characters[index], str(syllable), int(tone))
            offset += len(part["pinyin"])
        else:
            offset += len(normalize_text(part["text"]))
    if offset != len(normalized):
        raise KuraError("PINYIN_ALIGN_FAILED")
    phones = list(phones)
    tones = list(tones)
    for index, (character, syllable, tone) in overrides.items():
        # normalization replaces a few characters (嗯 -> 恩 and the like); compare in the same form
        if normalized[index] != normalize_text(character):
            raise KuraError("PINYIN_ALIGN_FAILED")
        # word2ph has one extra entry for the boundary phone at the start
        start = sum(word2ph[: index + 1])
        given = syllable_phones[syllable].split(" ")
        if len(given) != word2ph[index + 1]:
            raise KuraError("PINYIN_ALIGN_FAILED")
        phones[start : start + len(given)] = given
        tones[start : start + len(given)] = [tone] * len(given)
    return text, phones, tones


def _english_overrides(parts: List[dict]) -> Tuple[str, Dict[int, Tuple[list, int]]]:
    """Plain text plus the pronunciations given for words, by the position of the word.

    The position is the index in the library's word list (style_bert_vits2.nlp.english.g2p.__text_to_words) of the
    normalised text, which is what the library's g2p walks through. Only the wrapped words get the given
    pronunciation; the same word elsewhere is read as usual. Each target also carries the number of tokens of the
    wrapped word: the library joins a following "-" or "'" and what comes after it to the same word ("GAN-based",
    "Kura's"). The tokens after a "-" are read as usual; a contraction ("'s", "'ll") is read as the ending of the
    wrapped word.
    """
    from style_bert_vits2.nlp.english import g2p as english_g2p
    from style_bert_vits2.nlp.english.normalizer import normalize_text

    text_to_words = getattr(english_g2p, "__text_to_words")
    targets: Dict[int, Tuple[list, int]] = {}
    text = ""
    after_override = False
    for part in parts:
        if "words" not in part:
            # A word right after a wrapped word stays a separate word
            if after_override and part["text"][:1].isalnum():
                text += " "
            text += part["text"]
            after_override = False
            continue
        surface = part["surface"]
        if text and not text[-1].isspace():
            text += " "
        surface_words = text_to_words(normalize_text(surface))
        count = len(surface_words)
        if count != len(part["words"]):
            raise KuraError("IPA_WORD_SPLIT", surface)
        # Count the words before the wrapped ones together with them, so that spaces before them are tokenised the
        # same way as in the whole text (a run of spaces makes an empty word)
        first = len(text_to_words(normalize_text(text + surface))) - count
        for offset, phones in enumerate(part["words"]):
            targets[first + offset] = ([list(phones)], len(surface_words[offset]))
        text += surface
        after_override = True
    return text.strip(), targets


# Endings of contractions after a word given by IPA ("'s" depends on the last sound of the word)
_CONTRACTIONS = {"'ll": ["L"], "'re": ["R"], "'ve": ["V"], "'d": ["D"], "'m": ["M"]}
_SIBILANTS = {"S", "Z", "SH", "ZH", "CH", "JH"}
_VOICELESS = {"P", "T", "K", "F", "TH"}


def _english_contraction(text: str, last: str) -> Optional[list]:
    lower = text.lower()
    if lower == "'s":
        sound = "".join(ch for ch in last if not ch.isdigit())
        if sound in _SIBILANTS:
            return ["IH0", "Z"]
        return ["S"] if sound in _VOICELESS else ["Z"]
    return _CONTRACTIONS.get(lower)


def _english_g2p_with(targets: Dict[int, Tuple[list, int]]) -> Any:
    """The library's English g2p (style_bert_vits2.nlp.english.g2p.g2p, style-bert-vits2-mk 2.8.8) with the given
    pronunciations for the words at the given positions. A contraction right after a wrapped word is read as its
    ending; everything else follows the library's code (its consistency assertions are left out)."""
    from style_bert_vits2.nlp.english import g2p as module
    from style_bert_vits2.nlp.symbols import PUNCTUATIONS

    text_to_words = getattr(module, "__text_to_words")
    refine_syllables = getattr(module, "__refine_syllables")
    refine_ph = getattr(module, "__refine_ph")
    post_replace_ph = getattr(module, "__post_replace_ph")
    distribute_phone = getattr(module, "__distribute_phone")

    def g2p(text: str) -> Tuple[list, list, list]:
        phones: list = []
        tones: list = []
        phone_len: list = []
        words = text_to_words(text)
        for index, word in enumerate(words):
            temp_phones: list = []
            temp_tones: list = []
            rest = word
            if index in targets:
                syllables, tokens = targets[index]
                phns, tns = refine_syllables(syllables)
                temp_phones += [post_replace_ph(item) for item in phns]
                temp_tones += tns
                # The tokens joined after the wrapped word ("-based", "'s") are read as usual
                rest = word[tokens:]
                # A contraction right after the wrapped word ("'s", "'ll") is read as the ending of that word
                ending = _english_contraction("".join(rest), syllables[-1][-1] if syllables[-1] else "")
                if ending is not None:
                    phns, tns = refine_syllables([ending])
                    temp_phones += [post_replace_ph(item) for item in phns]
                    temp_tones += tns
                    rest = []
            if len(rest) > 1 and "'" in rest:
                rest = ["".join(rest)]
            for w in rest:
                if w in PUNCTUATIONS:
                    temp_phones.append(w)
                    temp_tones.append(0)
                    continue
                if w.upper() in module.eng_dict:
                    phns, tns = refine_syllables(module.eng_dict[w.upper()])
                    temp_phones += [post_replace_ph(item) for item in phns]
                    temp_tones += tns
                else:
                    phone_list = list(filter(lambda item: item != " ", module._g2p(w)))
                    phns, tns = [], []
                    for ph in phone_list:
                        if ph in module.ARPA:
                            ph, tn = refine_ph(ph)
                            phns.append(ph)
                            tns.append(tn)
                        else:
                            phns.append(ph)
                            tns.append(0)
                    temp_phones += [post_replace_ph(item) for item in phns]
                    temp_tones += tns
            phones += temp_phones
            tones += temp_tones
            phone_len.append(len(temp_phones))

        word2ph: list = []
        for token, length in zip(words, phone_len):
            word2ph += distribute_phone(length, len(token))
        phones = ["_"] + phones + ["_"]
        tones = [0] + tones + [0]
        word2ph = [1] + word2ph + [1]
        return phones, tones, word2ph

    return g2p


def _synthesize_piece(piece: dict, params: dict, model: Any) -> Any:
    import numpy as np

    language = params["language"]
    use_jp_extra = params["modelType"] == "jp-extra"
    base = params["params"]
    rate = float(base["speed"]) * float(piece["rate"])
    pitch_scale = float(base["pitchScale"]) * (2 ** (float(piece["pitch"]) / 12))
    kwargs = dict(
        language=_language(language),
        speaker_id=int(base["speakerId"]),
        sdp_ratio=float(base["sdpRatio"]),
        noise=float(base["noise"]),
        noise_w=float(base["noiseW"]),
        length=1.0 / rate,
        line_split=False,
        pitch_scale=pitch_scale,
        intonation_scale=float(base["intonationScale"]),
    )
    # Styles come only from the model; when the model has none, the library's own handling applies.
    if base.get("style"):
        kwargs.update(style=str(base["style"]), style_weight=float(base["styleWeight"]))
    parts = piece["parts"]
    if language == "ja" and any("kataTone" in part for part in parts):
        from style_bert_vits2.nlp import InvalidPhoneError

        text, phones, tones, reading = _japanese_given(parts, use_jp_extra)
        try:
            _rate, audio = model.infer(text=text, given_phone=phones, given_tone=tones, **kwargs)
        except InvalidPhoneError:
            # The surface text could not be aligned with the given reading; use the reading itself.
            _rate, audio = model.infer(text=reading, given_phone=phones, given_tone=tones, **kwargs)
    elif language == "zh" and any("pinyin" in part for part in parts):
        text, phones, tones = _chinese_given(parts)
        _rate, audio = model.infer(text=text, given_phone=phones, given_tone=tones, **kwargs)
    elif language == "en" and any("words" in part for part in parts):
        from style_bert_vits2.nlp.english import g2p as english_g2p

        # The library's text cleaning imports english.g2p.g2p each time, so it uses this one while synthesizing
        text, targets = _english_overrides(parts)
        original = english_g2p.g2p
        english_g2p.g2p = _english_g2p_with(targets)
        try:
            _rate, audio = model.infer(text=text, **kwargs)
        finally:
            english_g2p.g2p = original
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


# Length of one block of silence written at a time (seconds), so a long pause is never held in memory.
_SILENCE_BLOCK_SECONDS = 10


def _piece_text(piece: dict) -> str:
    return "".join(part["text"] if "text" in part else part["surface"] for part in piece["parts"])


def _check_bert_length(language: str, segments: List[dict]) -> None:
    """Stop before synthesis when a segment is longer than the language's BERT model can take.

    The library passes the text of a piece to the BERT model in one go without cutting it. Models with absolute
    positions (the Chinese RoBERTa) cannot take more tokens than their position table, so such a segment fails
    inside the library on any device; it is reported as too long instead (the user splits it). The DeBERTa models
    (Japanese, English) use relative positions and have no such limit: a long segment only needs more memory and
    time (when the GPU runs out of memory, it is made on the CPU).
    """
    from style_bert_vits2.nlp import bert_models

    lang = _language(language)
    config = bert_models.load_model(lang).config
    if getattr(config, "relative_attention", False) and not getattr(config, "position_biased_input", True):
        return
    limit = int(getattr(config, "max_position_embeddings", 0) or 0)
    if limit <= 0:
        return
    tokenizer = bert_models.load_tokenizer(lang)
    normalize = _bert_text_normalizer(language)
    for segment in segments:
        for piece in segment["pieces"]:
            if piece["kind"] != "speech" or not _speakable(piece):
                continue
            # Counted on the text the library passes to the model (normalised, e.g. numbers written in Chinese)
            if len(tokenizer(normalize(_piece_text(piece)))["input_ids"]) > limit:
                raise KuraError("TTS_SEGMENT_TOO_LONG", str(segment["id"]))


def _bert_text_normalizer(language: str) -> Any:
    """The normalisation the library applies to a piece's text before passing it to the BERT model (clean_text)."""
    if language == "zh":
        from style_bert_vits2.nlp.chinese.normalizer import normalize_text

        return normalize_text
    if language == "en":
        from style_bert_vits2.nlp.english.normalizer import normalize_text

        return normalize_text
    from style_bert_vits2.nlp.japanese.normalizer import normalize_text

    return normalize_text


def _write_segment(segment: dict, params: dict, model: Any, sample_rate: int, path: str) -> Tuple[int, List[dict]]:
    """Write one segment to a WAV file piece by piece and return its length in frames and where its parts are.

    Each piece is written as soon as it is made, so the pieces of a segment are never held in memory
    together. The parts ({"kind": "speech" | "silence", "start", "frames"}) let the caller fit a segment into a
    shorter time by stretching the speech only, keeping the pauses as they are.
    """
    import numpy as np
    import soundfile

    frames = 0
    parts: List[dict] = []

    def mark(kind: str, start: int, count: int) -> None:
        if count <= 0:
            return
        # Consecutive parts of the same kind are one part
        if parts and parts[-1]["kind"] == kind:
            parts[-1]["frames"] += count
        else:
            parts.append({"kind": kind, "start": start, "frames": count})

    with soundfile.SoundFile(path, "w", samplerate=sample_rate, channels=1, subtype="FLOAT") as out:
        for piece in segment["pieces"]:
            if piece["kind"] == "silence":
                start = frames
                remaining = int(sample_rate * float(piece["ms"]) / 1000.0)
                block = sample_rate * _SILENCE_BLOCK_SECONDS
                while remaining > 0:
                    count = min(remaining, block)
                    out.write(np.zeros(count, dtype=np.float32))
                    remaining -= count
                    frames += count
                mark("silence", start, frames - start)
            elif _speakable(piece):
                samples = _synthesize_piece(piece, params, model).astype(np.float32)
                out.write(samples)
                mark("speech", frames, len(samples))
                frames += len(samples)
    return frames, parts


def rpc_synthesize(params: dict, context: Context) -> dict:
    """Synthesize every segment into its own WAV file and report the durations."""
    _prepare()

    def run(device: str) -> List[dict]:
        context.phase("loadModel")
        _load_bert(params["language"], params["berts"])
        _check_bert_length(params["language"], params["segments"])
        model = _load_model(params, device)
        sample_rate = int(model.hyper_parameters.data.sampling_rate)
        results = []
        segments = params["segments"]
        context.phase("synthesize", 0.0)
        for index, segment in enumerate(segments):
            path = os.path.join(params["outputDir"], f"{segment['id']}.wav")
            frames, parts = _write_segment(segment, params, model, sample_rate, path)
            results.append(
                {"id": segment["id"], "path": path, "duration": frames / sample_rate, "sampleRate": sample_rate,
                 "parts": parts}
            )
            context.progress((index + 1) / len(segments), str(segment["id"]))
            context.phase("synthesize", (index + 1) / len(segments))
        return results

    return {"segments": runtime.run_with_cpu_fallback(run, unload)}


# Length of one block when mixing (seconds). Only one block and the parts of the clips that overlap it are
# held in memory, so memory use does not grow with the length of the text.
_ASSEMBLE_BLOCK_SECONDS = 10


def rpc_assemble(params: dict, context: Context) -> dict:
    """Place clips at their start times (seconds) and mix them into one file, block by block."""
    import numpy as np
    import soundfile

    sample_rate = int(params["sampleRate"])
    clips = []
    length = int(math.ceil(float(params["minDuration"]) * sample_rate))
    for placement in params["placements"]:
        info = soundfile.info(placement["path"])
        if info.samplerate != sample_rate:
            raise KuraError("SAMPLE_RATE_MISMATCH", f"{info.samplerate} != {sample_rate}")
        start = int(round(float(placement["start"]) * sample_rate))
        clips.append((start, info.frames, placement["path"]))
        length = max(length, start + info.frames)
    block = _ASSEMBLE_BLOCK_SECONDS * sample_rate

    def mix_block(begin: int, end: int) -> Any:
        mix = np.zeros(end - begin, dtype=np.float32)
        for start, frames, path in clips:
            first = max(begin, start)
            last = min(end, start + frames)
            if first >= last:
                continue
            data, _ = soundfile.read(path, start=first - start, stop=last - start, dtype="float32", always_2d=True)
            mix[first - begin : last - begin] += data.mean(axis=1)
        return mix

    # Pass 1: the peak of the whole mix (the mix is scaled down only when it would clip)
    peak = 0.0
    context.phase("assemble", 0.0)
    for begin in range(0, length, block):
        context.phase("assemble", 0.5 * begin / max(1, length))
        mix = mix_block(begin, min(length, begin + block))
        if len(mix):
            peak = max(peak, float(np.max(np.abs(mix))))
    scale = 1.0 / peak if peak > 1.0 else 1.0
    # Pass 2: write the mix block by block
    with soundfile.SoundFile(params["output"], "w", samplerate=sample_rate, channels=1, subtype="FLOAT") as out:
        for begin in range(0, length, block):
            context.phase("assemble", 0.5 + 0.5 * begin / max(1, length))
            mix = mix_block(begin, min(length, begin + block))
            out.write(mix * scale if scale != 1.0 else mix)
    return {"path": params["output"], "duration": length / sample_rate}


def rpc_inspect_style_vectors(params: dict, context: Context) -> dict:
    """Read style_vectors.npy as a plain numeric array and, when output is given, store a clean copy.

    Pickle data is not read unless the user accepted the risk (allowUnsafe); the copy never contains pickle data.
    """
    import numpy as np

    path = params["path"]
    try:
        vectors = np.load(path, allow_pickle=False)
        safe = True
    except Exception as error:
        if not params.get("allowUnsafe"):
            return {"safe": False, "detail": f"{type(error).__name__}: {error}"}
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
