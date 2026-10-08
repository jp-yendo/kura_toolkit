import { Button, IconButton, Stack, TextField, Tooltip, Typography } from '@mui/material';
import AudioFileOutlinedIcon from '@mui/icons-material/AudioFileOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import GraphicEqIcon from '@mui/icons-material/GraphicEq';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import { useTranslation } from 'react-i18next';
import FileDropTarget from '../common/FileDropTarget';
import Panel from '../common/Panel';
import RecorderControl from './RecorderControl';
import SyncPlayer from './SyncPlayer';
import { AUDIO_INPUT_EXTENSIONS } from './audioInput';
import { useInView } from '../../hooks/useInView';
import { showNotice } from '../../stores/noticeStore';
import type { RecordedAudio } from './useRecorder';
import type { TrainingAudio } from '@shared/voice/types';

type Props = {
    // 画面の並びの番号 (1 から)
    index: number;
    audio: TrainingAudio | null;
    text: string;
    // 処理中など、操作できない状態
    disabled: boolean;
    // どれかのグループが録音中 (録音中はファイルの指定・フィルター・削除をできなくし、録音のボタンは録音している
    // グループのものだけを使える)
    recordingActive: boolean;
    // このグループが録音中
    recordingThis: boolean;
    onRecordingChange(active: boolean): void;
    onRecorded(recorded: RecordedAudio): void;
    onChooseFile(): void;
    onDropFile(path: string): void;
    onFilter(): void;
    onRemove(): void;
    onTextChange(text: string): void;
    onTextBlur(): void;
    onLoadText(): void;
};

// 任意の文で作成する読み上げの学習セットのグループ 1 つ: 上の段 (番号・音声の名前と長さ・フィルター・グループの削除)、
// 下の段 (録音・音声ファイル選択・テキストファイル選択 (選んだファイルの内容で本文を置き換える))、波形のプレーヤー、本文の欄。
// 音声ファイルは、この枠に 1 つドロップしても指定できる。波形は、グループが画面に見えてきてから読み込む
export default function TrainingGroupRow({
    index,
    audio,
    text,
    disabled,
    recordingActive,
    recordingThis,
    onRecordingChange,
    onRecorded,
    onChooseFile,
    onDropFile,
    onFilter,
    onRemove,
    onTextChange,
    onTextBlur,
    onLoadText,
}: Props) {
    const { t } = useTranslation();
    const [ref, inView] = useInView<HTMLDivElement>();
    const locked = disabled || recordingActive;
    return (
        <FileDropTarget
            accept={AUDIO_INPUT_EXTENSIONS}
            disabled={locked}
            onFiles={paths => onDropFile(paths[0])}
            onRejected={() => showNotice('warning', t('voice.training.dropUnsupported'))}
        >
            <Panel>
                <Stack ref={ref} spacing={1}>
                    {/* 上の段: 番号・音声の名前と長さ、右端にフィルターとグループの削除 */}
                    <Stack direction='row' spacing={1} sx={{ alignItems: 'center' }}>
                        <Typography variant='body2' sx={{ fontWeight: 600, flexShrink: 0 }}>
                            {t('voice.training.groupTitle', { index })}
                        </Typography>
                        <Typography
                            variant='body2'
                            color='text.secondary'
                            sx={{ flexGrow: 1, minWidth: 0, overflowWrap: 'anywhere' }}
                        >
                            {/* 長さは下の波形のプレーヤーに示すため、名前だけを示す */}
                            {audio ? audio.name : t('voice.training.notRecorded')}
                        </Typography>
                        <Tooltip title={t('voice.filters.filterButton')}>
                            <span>
                                <IconButton
                                    size='small'
                                    aria-label={t('voice.filters.filterFor', { name: audio?.name ?? '' })}
                                    disabled={locked || !audio}
                                    onClick={onFilter}
                                >
                                    <GraphicEqIcon fontSize='small' />
                                </IconButton>
                            </span>
                        </Tooltip>
                        <Tooltip title={t('voice.training.removeGroup')}>
                            <span>
                                <IconButton
                                    size='small'
                                    aria-label={t('voice.training.removeGroupFor', { index })}
                                    disabled={locked}
                                    onClick={onRemove}
                                >
                                    <DeleteOutlineIcon fontSize='small' />
                                </IconButton>
                            </span>
                        </Tooltip>
                    </Stack>
                    {/* 下の段: 録音・音声ファイル選択・テキストファイル選択を左から並べる (録音中にメーターが広がっても、
                        ほかのボタンを押し出さないため)。録音中のグループでは、録音中に使えない音声ファイル選択を出さない */}
                    <Stack direction='row' spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
                        <RecorderControl
                            disabled={disabled || (recordingActive && !recordingThis)}
                            label={audio ? t('voice.training.rerecord') : undefined}
                            onActiveChange={onRecordingChange}
                            onRecorded={onRecorded}
                        />
                        {!recordingThis && (
                            <Button startIcon={<AudioFileOutlinedIcon />} disabled={locked} onClick={onChooseFile}>
                                {t('voice.training.chooseAudioFile')}
                            </Button>
                        )}
                        <Button startIcon={<DescriptionOutlinedIcon />} disabled={disabled} onClick={onLoadText}>
                            {t('voice.training.chooseTextFile')}
                        </Button>
                    </Stack>
                    {/* 録音し直したとき・指定し直したときは、先頭から止めた状態で示す */}
                    <SyncPlayer
                        source={audio && inView ? { key: audio.id + audio.media.url, url: audio.media.url } : null}
                        keepPosition={false}
                    />
                    <TextField
                        multiline
                        minRows={4}
                        fullWidth
                        size='small'
                        label={t('voice.training.groupText')}
                        value={text}
                        disabled={disabled}
                        onChange={event => onTextChange(event.target.value)}
                        onBlur={onTextBlur}
                    />
                </Stack>
            </Panel>
        </FileDropTarget>
    );
}
