import React from 'react';
import { FormControl, InputLabel, MenuItem, Select } from '@mui/material';
import { useTranslation } from 'react-i18next';
import {
    AAC_BITRATES,
    AUDIO_ENCODE_DEFAULTS,
    AUDIO_FORMAT_LABELS,
    AUDIO_FORMATS,
    FLAC_COMPRESSION_LEVELS,
    LOSSLESS_BITS,
    MP3_BITRATES,
    OPUS_BITRATES,
    SAMPLE_RATES,
    VORBIS_QUALITIES,
    WAV_SAMPLE_FORMATS,
    type AudioEncodeSettings,
    type AudioFormat,
} from '@shared/audio-format';

// 使っている ffmpeg で書き出せる形式 (アプリの起動中は 1 回だけ問い合わせる。分からないうちはすべての形式を出す)
let formatsRequest: Promise<AudioFormat[]> | null = null;

function useAudioFormats(): AudioFormat[] {
    const [formats, setFormats] = React.useState<AudioFormat[]>(AUDIO_FORMATS);
    React.useEffect(() => {
        let cancelled = false;
        formatsRequest ??= window.kuraToolkit.audio.formats();
        formatsRequest
            .then(result => {
                if (!cancelled) setFormats(result);
            })
            .catch(() => {
                formatsRequest = null;
            });
        return () => {
            cancelled = true;
        };
    }, []);
    return formats;
}

type Choice<T> = { value: T; label: string };

// 選択肢のドロップダウン (defaultValue を渡した欄だけ、その項目に「(既定)」と添える。今は FLAC の圧縮レベルだけ)
function ChoiceField<T extends string | number>({
    id,
    label,
    value,
    choices,
    defaultValue,
    onChange,
    disabled,
    width = 160,
}: {
    id: string;
    label: string;
    value: T;
    choices: Choice<T>[];
    defaultValue?: T;
    onChange(value: T): void;
    disabled?: boolean;
    width?: number;
}) {
    const { t } = useTranslation();
    return (
        <FormControl size='small' sx={{ width }} disabled={disabled}>
            <InputLabel id={id}>{label}</InputLabel>
            <Select
                labelId={id}
                label={label}
                value={value}
                onChange={event => {
                    const raw = event.target.value;
                    const next = choices.find(choice => String(choice.value) === String(raw));
                    if (next) onChange(next.value);
                }}
            >
                {choices.map(choice => (
                    <MenuItem key={String(choice.value)} value={choice.value}>
                        {choice.value === defaultValue
                            ? t('common.defaultValue', { value: choice.label })
                            : choice.label}
                    </MenuItem>
                ))}
            </Select>
        </FormControl>
    );
}

type Props = {
    // 形式の欄の名前 (画面ごとの言い方)
    label: string;
    format: AudioFormat | 'keep';
    settings: AudioEncodeSettings;
    onFormat(format: AudioFormat | 'keep'): void;
    onSettings(patch: Partial<AudioEncodeSettings>): void;
    // 「元の形式のまま」を選べるようにする (オーディオ正規化だけ)
    allowKeep?: boolean;
    disabled?: boolean;
    // 欄の名前の重複を避けるための接頭辞
    idPrefix: string;
};

// 書き出しの形式と、その形式で使う設定の欄 (オーディオ正規化と音声機能の書き出しで共用する)。選んだ形式で使わない設定は
// 出さない。並べ方は呼び出し側の行に任せる (欄だけを返す)
export default function AudioFormatFields({
    label,
    format,
    settings,
    onFormat,
    onSettings,
    allowKeep,
    disabled,
    idPrefix,
}: Props) {
    const { t } = useTranslation();
    const available = useAudioFormats();
    // 選んでいる形式が使えない ffmpeg に変わった場合も、選んだものは一覧に残す (書き出すと失敗として知らせる)
    const formats = available.includes(format as AudioFormat) || format === 'keep' ? available : [...available, format];
    const d = AUDIO_ENCODE_DEFAULTS;
    const id = (name: string) => `${idPrefix}-${name}`;
    const sampleRate = (
        <ChoiceField
            id={id('sample-rate')}
            label={t('common.audioFormat.sampleRate')}
            value={settings.sampleRate}
            choices={SAMPLE_RATES.map(rate => ({ value: rate, label: `${rate} Hz` }))}
            onChange={value => onSettings({ sampleRate: value })}
            disabled={disabled}
            width={180}
        />
    );
    const kbps = (values: number[]) => values.map(value => ({ value, label: `${value} kbps` }));
    const bits = (values: number[]) => values.map(value => ({ value, label: `${value} bit` }));
    return (
        <>
            <ChoiceField<AudioFormat | 'keep'>
                id={id('format')}
                label={label}
                value={format}
                choices={[
                    ...(allowKeep ? [{ value: 'keep' as const, label: t('common.audioFormat.keep') }] : []),
                    ...formats.map(item => ({ value: item, label: AUDIO_FORMAT_LABELS[item as AudioFormat] })),
                ]}
                onChange={onFormat}
                disabled={disabled}
                width={180}
            />
            {format === 'mp3' && (
                <>
                    {sampleRate}
                    <ChoiceField
                        id={id('bitrate-mode')}
                        label={t('common.audioFormat.bitrateMode')}
                        value={settings.bitrateMode}
                        choices={[
                            { value: 'cbr', label: 'CBR' },
                            { value: 'vbr', label: 'VBR' },
                        ]}
                        onChange={value => onSettings({ bitrateMode: value })}
                        disabled={disabled}
                    />
                    <ChoiceField
                        id={id('bitrate')}
                        label={t('common.audioFormat.bitrate')}
                        value={settings.bitrate}
                        choices={kbps(MP3_BITRATES)}
                        onChange={value => onSettings({ bitrate: value })}
                        disabled={disabled}
                    />
                </>
            )}
            {format === 'flac' && (
                <>
                    {sampleRate}
                    <ChoiceField
                        id={id('flac-bits')}
                        label={t('common.audioFormat.bits')}
                        value={settings.flacBits}
                        choices={bits(LOSSLESS_BITS) as Choice<16 | 24>[]}
                        onChange={value => onSettings({ flacBits: value })}
                        disabled={disabled}
                    />
                    <ChoiceField
                        id={id('flac-compression')}
                        label={t('common.audioFormat.compression')}
                        value={settings.flacCompression}
                        choices={FLAC_COMPRESSION_LEVELS.map(level => ({ value: level, label: String(level) }))}
                        defaultValue={d.flacCompression}
                        onChange={value => onSettings({ flacCompression: value })}
                        disabled={disabled}
                    />
                </>
            )}
            {format === 'vorbis' && (
                <>
                    {sampleRate}
                    <ChoiceField
                        id={id('vorbis-quality')}
                        label={t('common.audioFormat.quality')}
                        value={settings.vorbisQuality}
                        choices={VORBIS_QUALITIES.map(quality => ({ value: quality, label: String(quality) }))}
                        onChange={value => onSettings({ vorbisQuality: value })}
                        disabled={disabled}
                    />
                </>
            )}
            {format === 'opus' && (
                <ChoiceField
                    id={id('opus-bitrate')}
                    label={t('common.audioFormat.bitrate')}
                    value={settings.opusBitrate}
                    choices={kbps(OPUS_BITRATES)}
                    onChange={value => onSettings({ opusBitrate: value })}
                    disabled={disabled}
                />
            )}
            {format === 'aac' && (
                <>
                    {sampleRate}
                    <ChoiceField
                        id={id('aac-bitrate')}
                        label={t('common.audioFormat.bitrate')}
                        value={settings.aacBitrate}
                        choices={kbps(AAC_BITRATES)}
                        onChange={value => onSettings({ aacBitrate: value })}
                        disabled={disabled}
                    />
                </>
            )}
            {format === 'wav' && (
                <>
                    {sampleRate}
                    <ChoiceField
                        id={id('wav-format')}
                        label={t('common.audioFormat.bits')}
                        value={settings.wavFormat}
                        choices={WAV_SAMPLE_FORMATS.map(item => ({
                            value: item,
                            label: item === 'f32' ? t('common.audioFormat.float32') : `${item.slice(1)} bit`,
                        }))}
                        onChange={value => onSettings({ wavFormat: value })}
                        disabled={disabled}
                        width={180}
                    />
                </>
            )}
            {format === 'alac' && (
                <>
                    {sampleRate}
                    <ChoiceField
                        id={id('alac-bits')}
                        label={t('common.audioFormat.bits')}
                        value={settings.alacBits}
                        choices={bits(LOSSLESS_BITS) as Choice<16 | 24>[]}
                        onChange={value => onSettings({ alacBits: value })}
                        disabled={disabled}
                    />
                </>
            )}
        </>
    );
}
