// 音声分離の目的別のおすすめ (ダウンロードの画面と分離の画面で共有する)

// 目的別のおすすめ。配布元が検証した組み合わせ (ensemble) を目的ごとに並べる。同梱の組み合わせが無い目的は、
// その目的のための単体のモデル (model) を示す。labelKey は行に添える位置づけ (標準・段階など)
export type PurposeEntry = { kind: 'ensemble'; id: string; labelKey?: string } | { kind: 'model'; filename: string };
export type Purpose = { id: string; entries: PurposeEntry[] };

export const SEPARATOR_PURPOSES: Purpose[] = [
    {
        id: 'vocals',
        entries: [
            { kind: 'ensemble', id: 'vocal_balanced', labelKey: 'voice.library.separatorPurposeLabels.standard' },
            { kind: 'ensemble', id: 'vocal_clean' },
            { kind: 'ensemble', id: 'vocal_full' },
            { kind: 'ensemble', id: 'vocal_rvc' },
        ],
    },
    {
        id: 'accompaniment',
        entries: [
            {
                kind: 'ensemble',
                id: 'instrumental_balanced',
                labelKey: 'voice.library.separatorPurposeLabels.standard',
            },
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
];
