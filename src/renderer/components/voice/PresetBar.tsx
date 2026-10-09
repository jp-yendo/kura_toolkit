import CommonPresetBar from '../common/PresetBar';
import type { PresetApi, VoicePresetParams } from '@shared/ipc';
import type { PresetKind, PresetRecord } from '@shared/voice/types';

type Props<T extends VoicePresetParams> = {
    kind: PresetKind;
    // 一覧に出すプリセットの絞り込み (分離はアーキテクチャが同じものだけ)
    filter?(preset: PresetRecord<VoicePresetParams>): boolean;
    // 保存する内容 (現在の値)
    current(): T;
    onApply(params: T): void;
    disabled?: boolean;
};

// 種類ごとの API (一覧の読み直しは API が変わったときに行うため、種類ごとに同じものを使う)
const apis = new Map<PresetKind, PresetApi<VoicePresetParams>>();

function voicePresetApi(kind: PresetKind): PresetApi<VoicePresetParams> {
    let api = apis.get(kind);
    if (!api) {
        const presets = window.kuraToolkit.voice.presets;
        api = {
            list: () => presets.list(kind),
            save: preset => presets.save(kind, preset),
            rename: (id, name) => presets.rename(kind, id, name),
            remove: id => presets.remove(kind, id),
        };
        apis.set(kind, api);
    }
    return api;
}

// 音声機能 (分離の条件・合成のパラメーター) のプリセット
export default function PresetBar<T extends VoicePresetParams>({ kind, filter, current, onApply, disabled }: Props<T>) {
    return (
        <CommonPresetBar<VoicePresetParams>
            id={kind}
            api={voicePresetApi(kind)}
            filter={filter}
            current={current}
            // 一覧は種類ごとのファイルなので、選んだプリセットはこの種類の値を持つ
            onApply={params => onApply(params as T)}
            disabled={disabled}
            errorKeyPrefixes={['voice.errors']}
        />
    );
}
