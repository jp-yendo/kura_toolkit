import React from 'react';
import { Box, Button, Collapse, DialogActions, DialogContent, DialogTitle, Stack } from '@mui/material';
import CallSplitIcon from '@mui/icons-material/CallSplit';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useTranslation } from 'react-i18next';
import AppDialog from '../common/AppDialog';
import SectionLabel from '../common/SectionLabel';
import PresetBar from './PresetBar';
import SeparationParamsForm from './SeparationParamsForm';
import SeparationMethodPicker, {
    EMPTY_METHOD_SELECTION,
    hasUnavailableChoice,
    activePickMode,
    resolveMethod,
    SelectedMethodPanel,
    useDisabledPickModes,
    type MethodSelection,
} from './SeparationMethodPicker';
import { showNotice } from '../../stores/noticeStore';
import { DEFAULT_SEPARATION_PARAMS } from '../../stores/separationWorkStore';
import type {
    SeparationMethod,
    SeparationModelList,
    SeparationParams,
    SeparationPresetParams,
} from '@shared/voice/types';
import type { VoicePresetParams } from '@shared/ipc';

// 分離のプリセット (方式の選び方と詳細な設定を持ち、選び方がおすすめ・モデル・その他のもの) だけを示す
function isSeparationPreset(params: VoicePresetParams): params is SeparationPresetParams {
    return (
        typeof params === 'object' &&
        params !== null &&
        'method' in params &&
        'params' in params &&
        (params.method.mode === 'recommended' ||
            params.method.mode === 'model' ||
            params.method.mode === 'other' ||
            params.method.mode === 'effects')
    );
}

type Props = {
    open: boolean;
    // 分離する音の名前
    inputLabel: string;
    // 分離する音がステレオか (エフェクトのリバーブのステレオの広がりの添え書きに使う)
    inputStereo: boolean;
    models: SeparationModelList | null;
    // 開いたときの条件 (作り直すときは前回の条件)
    initialSelection: MethodSelection;
    initialParams: SeparationParams;
    // 分離する。成功したら true (ダイアログを閉じる)。失敗・中止のときは開いたまま (条件を変えてやり直せる)
    onRun(selection: MethodSelection, method: SeparationMethod, params: SeparationParams): Promise<boolean>;
    onClose(): void;
    disabled?: boolean;
};

// 分離のダイアログ。分離する音の「分岐」と、結果の「パラメーターを変えて作成」から開く。
// 左にプリセット (どのタブでも共通)・方式 (おすすめ・モデル・除去・調整・エフェクト)・詳細な設定、右に選んだ内容を置き、
// 選んで分離する。
// 幅が足りないときは、選んだ内容を下に置く
export default function SeparationDialog({
    open,
    inputLabel,
    inputStereo,
    models,
    initialSelection,
    initialParams,
    onRun,
    onClose,
    disabled,
}: Props) {
    const { t } = useTranslation();
    const [selection, setSelection] = React.useState<MethodSelection>(initialSelection);
    const [params, setParams] = React.useState<SeparationParams>(initialParams);
    const [advanced, setAdvanced] = React.useState(false);
    const [running, setRunning] = React.useState(false);

    // 開くたびに、渡された条件に戻す
    React.useEffect(() => {
        if (!open) return;
        setSelection(initialSelection);
        setParams(initialParams);
        setAdvanced(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- 開いた時点の条件で初期化する
    }, [open]);

    // 選べない選び方 (分離のモデルを使えない環境のモデルのタブ)
    const disabledModes = useDisabledPickModes();
    const resolved = resolveMethod(selection, models, disabledModes);
    // 開いているタブ (選べないタブは開かないため、選んだ内容のタブと異なることがある)
    const activeMode = activePickMode(selection, models, disabledModes);
    const busy = disabled || running;

    // プリセットの呼び出し: 方式の選び方 (おすすめ・モデル・除去・調整・エフェクト) と詳細な設定をまとめて戻す
    // (取得していないものを含む場合は知らせる)
    const applyPreset = (preset: SeparationPresetParams) => {
        setSelection({ ...EMPTY_METHOD_SELECTION, ...preset.method });
        setParams({
            mdx: { ...DEFAULT_SEPARATION_PARAMS.mdx, ...preset.params.mdx },
            vr: { ...DEFAULT_SEPARATION_PARAMS.vr, ...preset.params.vr },
            demucs: { ...DEFAULT_SEPARATION_PARAMS.demucs, ...preset.params.demucs },
            mdxc: { ...DEFAULT_SEPARATION_PARAMS.mdxc, ...preset.params.mdxc },
        });
        if (hasUnavailableChoice(preset.method, models)) {
            showNotice('warning', t('voice.separation.presetUnavailable'), 10000);
        }
    };

    const run = async () => {
        if (!resolved.method) return;
        setRunning(true);
        try {
            if (await onRun(selection, resolved.method, params)) onClose();
        } finally {
            setRunning(false);
        }
    };

    return (
        <AppDialog
            open={open}
            onClose={busy ? undefined : onClose}
            maxWidth='md'
            fullWidth
            // 高さは中身によらず一定にし、中身が長いときはダイアログの中をスクロールする
            slotProps={{ paper: { sx: { height: 'min(760px, calc(100% - 64px))' } } }}
        >
            <DialogTitle sx={{ overflowWrap: 'anywhere' }}>
                {t('voice.separation.dialogTitle', { input: inputLabel })}
            </DialogTitle>
            {/* 2 列のときは列ごとにスクロールし、1 列のときは全体をスクロールする。列はスクロールバーの幅を常に空け、右に余白を
                取る (スクロールバーと欄の右端が接して操作しにくくならないように) */}
            <DialogContent
                sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) minmax(0, 1fr)' },
                    gridTemplateRows: { md: 'minmax(0, 1fr)' },
                    columnGap: 3,
                    rowGap: 2,
                    overflowY: { xs: 'auto', md: 'hidden' },
                }}
            >
                <Stack
                    spacing={2}
                    sx={{
                        pt: 1,
                        minHeight: 0,
                        overflowY: { md: 'auto' },
                        // スライダーのつまみが端で欄の外へわずかにはみ出すため、横には広げない
                        overflowX: 'hidden',
                        scrollbarGutter: { md: 'stable' },
                        pr: { md: 1.5 },
                    }}
                >
                    <SeparationMethodPicker
                        models={models}
                        // プリセットは、方式の選び方 (おすすめ・モデル・除去・調整・エフェクト) から詳細な設定までの条件一式を
                        // 保存・呼び出しする
                        presets={
                            <PresetBar<SeparationPresetParams>
                                kind='separation'
                                disabled={busy}
                                filter={preset => isSeparationPreset(preset.params)}
                                current={() => ({ method: selection, params })}
                                onApply={applyPreset}
                            />
                        }
                        value={selection}
                        inputStereo={inputStereo}
                        onChange={setSelection}
                        disabled={busy}
                    />
                    {resolved.archs.length > 0 && (
                        <Box>
                            <Button
                                size='small'
                                color='inherit'
                                startIcon={advanced ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                                aria-expanded={advanced}
                                onClick={() => setAdvanced(value => !value)}
                            >
                                {t('voice.separation.advanced')}
                            </Button>
                            <Collapse in={advanced} unmountOnExit>
                                <Stack spacing={2} sx={{ pt: 1.5 }}>
                                    {resolved.archs.map(arch => (
                                        <Stack key={arch} spacing={1}>
                                            <SectionLabel>{t('voice.separation.paramsFor', { arch })}</SectionLabel>
                                            <SeparationParamsForm
                                                arch={arch}
                                                params={params}
                                                onChange={setParams}
                                                disabled={busy}
                                            />
                                        </Stack>
                                    ))}
                                </Stack>
                            </Collapse>
                        </Box>
                    )}
                </Stack>
                <Stack
                    spacing={1}
                    sx={{
                        pt: 1,
                        minHeight: 0,
                        overflowY: { md: 'auto' },
                        // スライダーのつまみが端で欄の外へわずかにはみ出すため、横には広げない
                        overflowX: 'hidden',
                        scrollbarGutter: { md: 'stable' },
                        pr: { md: 1.5 },
                    }}
                >
                    <SectionLabel>{t('voice.separation.selectedTitle')}</SectionLabel>
                    <SelectedMethodPanel models={models} value={selection} disabledModes={disabledModes} />
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={busy}>
                    {t('common.cancel')}
                </Button>
                <Button
                    variant='contained'
                    startIcon={<CallSplitIcon />}
                    disabled={busy || !resolved.method}
                    onClick={() => void run()}
                >
                    {/* 開いているタブ (その分岐の方式) に合わせた名前にする (除去・調整とエフェクトは分離しないため) */}
                    {t(
                        activeMode === 'other'
                            ? 'voice.separation.runProcess'
                            : activeMode === 'effects'
                              ? 'voice.separation.runEffects'
                              : 'voice.separation.run'
                    )}
                </Button>
            </DialogActions>
        </AppDialog>
    );
}
