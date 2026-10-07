// 音声分離の目的別のおすすめ (ダウンロードの画面と分離の画面で共有する)

import { DEREVERB_MODELS, NOISE_REMOVAL_MODELS } from '@shared/voice/audio-filters';

// 目的別のおすすめ。配布元が検証した組み合わせ (ensemble) を目的ごとに並べる。同梱の組み合わせが無い目的は、
// その目的のための単体のモデル (model) を示す。配布元は組み合わせの間に順位や「標準」を決めていないため、
// 順位の印は付けない。labelKey は、2 回に分けて分離する目的で、どの回に使うかを行に添えるもの
export type PurposeEntry = { kind: 'ensemble'; id: string; labelKey?: string } | { kind: 'model'; filename: string };
export type Purpose = { id: string; entries: PurposeEntry[] };

export const SEPARATOR_PURPOSES: Purpose[] = [
    {
        id: 'vocals',
        entries: [
            { kind: 'ensemble', id: 'vocal_balanced' },
            { kind: 'ensemble', id: 'vocal_clean' },
            { kind: 'ensemble', id: 'vocal_full' },
            { kind: 'ensemble', id: 'vocal_rvc' },
        ],
    },
    {
        id: 'accompaniment',
        entries: [
            { kind: 'ensemble', id: 'instrumental_balanced' },
            { kind: 'ensemble', id: 'instrumental_clean' },
            { kind: 'ensemble', id: 'instrumental_full' },
            { kind: 'ensemble', id: 'instrumental_low_resource' },
        ],
    },
    { id: 'both', entries: [{ kind: 'model', filename: 'melband_roformer_instvox_duality_v2.ckpt' }] },
    {
        id: 'layers',
        entries: [
            { kind: 'ensemble', id: 'vocal_balanced', labelKey: 'voice.library.separatorPurposeLabels.step1' },
            { kind: 'ensemble', id: 'karaoke', labelKey: 'voice.library.separatorPurposeLabels.step2' },
        ],
    },
    // ノイズ除去のおすすめは、ノイズ除去の「モデルで除去する」で選べるモデルと同じ (NOISE_REMOVAL_MODELS)
    {
        id: 'denoise',
        entries: NOISE_REMOVAL_MODELS.map(model => ({ kind: 'model' as const, filename: model.filename })),
    },
    // 残響・エコーの除去のおすすめは、残響・エコーの除去で選べるモデルと同じ (DEREVERB_MODELS)
    {
        id: 'dereverb',
        entries: DEREVERB_MODELS.map(model => ({ kind: 'model' as const, filename: model.filename })),
    },
];
