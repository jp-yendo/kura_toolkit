"""Check the training transcripts before the long steps of training (run through script_runner.py).

Usage: python script_runner.py --patch sbv2 --root <repository> -- sbv2_check_text.py <texts.json> <language> <use_jp_extra> <error code>

texts.json lists ``{"label", "text"}`` with the text exactly as it goes into the training list. Each text
goes through the same text processing as the repository's preprocess_text.py (the user dictionary applied,
clean_text with reading errors raised), and, for a BERT model with a fixed position table (the Chinese
RoBERTa), the tokens bert_gen.py would pass to it are counted against that table. The labels of the texts
that would make either step fail are reported with the given error code, so that training stops before
resampling and feature extraction instead of failing in the middle with only a line count.
"""

from __future__ import annotations

import json
import sys

from kura_voice.protocol import KuraError
from style_bert_vits2.constants import DEFAULT_BERT_MODEL_PATHS, Languages
from style_bert_vits2.nlp import clean_text
from style_bert_vits2.nlp.japanese import pyopenjtalk_worker
from style_bert_vits2.nlp.japanese.user_dict import update_dict

# The labels shown in the error (the rest is counted)
SHOWN_LABELS = 20


def bert_limit(language: Languages) -> int:
    """The most tokens the language's BERT model takes (0: no limit, the models with relative positions)."""
    from transformers import AutoConfig

    config = AutoConfig.from_pretrained(str(DEFAULT_BERT_MODEL_PATHS[language]))
    if getattr(config, "relative_attention", False) and not getattr(config, "position_biased_input", True):
        return 0
    return int(getattr(config, "max_position_embeddings", 0) or 0)


def main() -> int:
    with open(sys.argv[1], "r", encoding="utf-8") as handle:
        items = json.load(handle)
    language = {"ja": Languages.JP, "en": Languages.EN, "zh": Languages.ZH}[sys.argv[2]]
    use_jp_extra = sys.argv[3] == "True"
    error_code = sys.argv[4]

    # As preprocess_text.py does when it is loaded
    pyopenjtalk_worker.initialize_worker()
    update_dict()

    limit = bert_limit(language)
    tokenizer = None
    if limit > 0:
        from transformers import AutoTokenizer

        tokenizer = AutoTokenizer.from_pretrained(str(DEFAULT_BERT_MODEL_PATHS[language]))

    failed = []
    for item in items:
        try:
            norm_text = clean_text(
                text=item["text"], language=language, use_jp_extra=use_jp_extra, raise_yomi_error=True
            )[0]
        except Exception as error:
            print(f"{item['label']}: {error}", file=sys.stderr, flush=True)
            failed.append(item["label"])
            continue
        # bert_gen.py passes the normalised text to the BERT model in one go
        if tokenizer is not None and len(tokenizer(norm_text)["input_ids"]) > limit:
            print(f"{item['label']}: longer than {limit} tokens", file=sys.stderr, flush=True)
            failed.append(item["label"])
    if failed:
        shown = ", ".join(failed[:SHOWN_LABELS])
        if len(failed) > SHOWN_LABELS:
            shown += f" (+{len(failed) - SHOWN_LABELS})"
        raise KuraError(error_code, shown)
    print(f"Checked {len(items)} texts.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
