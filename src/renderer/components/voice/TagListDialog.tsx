import React from 'react';
import {
    Box,
    Button,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    Stack,
    Tab,
    Tabs,
    Typography,
} from '@mui/material';
import SaveAltIcon from '@mui/icons-material/SaveAlt';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import AppDialog from '../common/AppDialog';
import { voiceErrorMessage } from './voiceErrors';
import { showNotice } from '../../stores/noticeStore';
import type { VoiceLanguage } from '@shared/voice/languages';

type TagExample = {
    // 選択範囲の前に入れる文字列 (after が無い場合はカーソル位置に挿入する)
    before: string;
    after?: string;
    // 選択範囲が無いときに挟む文字列
    placeholder?: string;
};

// タグの種類。ssml: W3C SSML 1.1 の要素と同じ書き方のもの / custom: このアプリ独自のもの
// (SSML の要素でも、独自の表記 (x-kana・x-pinyin) を使うものは独自のものとする)
type TagGroup = 'ssml' | 'custom';
const TAG_GROUPS: TagGroup[] = ['ssml', 'custom'];

type TagDoc = {
    group: TagGroup;
    tag: string;
    descriptionKey: string;
    attributes: { name: string; formatKey: string }[];
    examples: TagExample[];
};

// 言語ごとの例 (挿入する文字列なので翻訳はしない)
type LanguageSamples = {
    faster: string;
    higher: string;
    quieter: string;
    sub: TagExample;
    phonemeDescriptionKey: string;
    phKey: string;
    phoneme: TagExample[];
    // 発音の指定の表記が SSML の標準 (ipa) か、独自の表記か
    phonemeGroup: TagGroup;
};

const SAMPLES: Record<VoiceLanguage, LanguageSamples> = {
    ja: {
        faster: 'ここを速く',
        higher: 'ここを高く',
        quieter: 'ここを小さく',
        sub: { before: '<sub alias="ダブリューエイチオー">', after: '</sub>', placeholder: 'WHO' },
        phonemeDescriptionKey: 'voice.tags.phoneme.descriptionJa',
        phonemeGroup: 'custom',
        phKey: 'voice.tags.phoneme.phJa',
        phoneme: [
            { before: `<phoneme ph="ハ'シ">`, after: '</phoneme>', placeholder: '箸' },
            { before: `<phoneme ph="ハシ'">`, after: '</phoneme>', placeholder: '橋' },
            { before: `<phoneme ph="キョ'ウワ/イ'イ/テンキ">`, after: '</phoneme>', placeholder: '今日はいい天気' },
        ],
    },
    en: {
        faster: 'faster here',
        higher: 'higher here',
        quieter: 'quieter here',
        sub: { before: '<sub alias="World Health Organization">', after: '</sub>', placeholder: 'WHO' },
        phonemeDescriptionKey: 'voice.tags.phoneme.descriptionEn',
        phonemeGroup: 'ssml',
        phKey: 'voice.tags.phoneme.phEn',
        phoneme: [{ before: '<phoneme alphabet="ipa" ph="təˈmɑːtoʊ">', after: '</phoneme>', placeholder: 'tomato' }],
    },
    zh: {
        faster: '这里加快',
        higher: '这里提高',
        quieter: '这里变小',
        sub: { before: '<sub alias="世界卫生组织">', after: '</sub>', placeholder: 'WHO' },
        phonemeDescriptionKey: 'voice.tags.phoneme.descriptionZh',
        phonemeGroup: 'custom',
        phKey: 'voice.tags.phoneme.phZh',
        phoneme: [
            { before: '<phoneme alphabet="x-pinyin" ph="yin2 hang2">', after: '</phoneme>', placeholder: '银行' },
            { before: '<phoneme alphabet="x-pinyin" ph="chong2 xin1">', after: '</phoneme>', placeholder: '重新' },
        ],
    },
};

function tagDocs(language: VoiceLanguage): TagDoc[] {
    const samples = SAMPLES[language];
    return [
        {
            group: 'ssml',
            tag: 'break',
            descriptionKey: 'voice.tags.break.description',
            attributes: [
                { name: 'time', formatKey: 'voice.tags.break.time' },
                { name: 'strength', formatKey: 'voice.tags.break.strength' },
            ],
            examples: [{ before: '<break time="500ms"/>' }, { before: '<break strength="strong"/>' }],
        },
        {
            group: 'ssml',
            tag: 'prosody',
            descriptionKey: 'voice.tags.prosody.description',
            attributes: [
                { name: 'rate', formatKey: 'voice.tags.prosody.rate' },
                { name: 'pitch', formatKey: 'voice.tags.prosody.pitch' },
                { name: 'volume', formatKey: 'voice.tags.prosody.volume' },
            ],
            examples: [
                { before: '<prosody rate="120%">', after: '</prosody>', placeholder: samples.faster },
                { before: '<prosody pitch="+2st">', after: '</prosody>', placeholder: samples.higher },
                { before: '<prosody volume="-6dB">', after: '</prosody>', placeholder: samples.quieter },
            ],
        },
        {
            group: 'ssml',
            tag: 'sub',
            descriptionKey: 'voice.tags.sub.description',
            attributes: [{ name: 'alias', formatKey: 'voice.tags.sub.alias' }],
            examples: [samples.sub],
        },
        {
            group: samples.phonemeGroup,
            tag: 'phoneme',
            descriptionKey: samples.phonemeDescriptionKey,
            attributes: [
                { name: 'ph', formatKey: samples.phKey },
                { name: 'alphabet', formatKey: 'voice.tags.phoneme.alphabet' },
            ],
            examples: samples.phoneme,
        },
        {
            group: 'custom',
            tag: 'fit',
            descriptionKey: 'voice.tags.fit.description',
            attributes: [{ name: 'mode', formatKey: 'voice.tags.fit.mode' }],
            examples: [{ before: '<fit mode="shift"/>' }, { before: '<fit mode="overlap"/>' }],
        },
    ];
}

function exampleText(example: TagExample): string {
    return `${example.before}${example.after ? `${example.placeholder ?? ''}${example.after}` : ''}`;
}

// 一覧と同じ内容 (説明・属性と値の書式・記述例) を Markdown にする
function tagListMarkdown(t: TFunction, language: VoiceLanguage): string {
    const lines: string[] = [
        `# ${t('voice.tags.title')} (${t(`voice.languages.${language}`)})`,
        '',
        t('voice.tags.fileIntro'),
        '',
    ];
    // 種類 (SSML・独自形式) ごとに分ける
    for (const group of TAG_GROUPS) {
        lines.push(`## ${t(`voice.tags.groups.${group}`)}`, '');
        for (const doc of tagDocs(language).filter(item => item.group === group)) {
            lines.push(`### \`<${doc.tag}>\``, '', t(doc.descriptionKey).split('\n').join('\n\n'), '');
            for (const attribute of doc.attributes) lines.push(`- \`${attribute.name}\`: ${t(attribute.formatKey)}`);
            lines.push('', '```xml', ...doc.examples.map(exampleText), '```', '');
        }
    }
    // 置き換え表記とタグ名の書き出しは、Markdown として表示しても文字のまま見えるようコードにする
    const escape = t('voice.tags.escape').replace(/(&[a-z]+;|<[a-z]+)/g, '`$1`');
    lines.push(`## ${t('voice.tags.escapeTitle')}`, '', escape.split('\n').join('\n\n'), '');
    return lines.join('\n');
}

type Props = {
    open: boolean;
    language: VoiceLanguage;
    onClose(): void;
    onInsert(example: TagExample): void;
};

// 制御タグの一覧。説明・属性と値の書式・記述例を示し、選んだ例をカーソル位置に挿入する (選択範囲があれば囲む)
export default function TagListDialog({ open, language, onClose, onInsert }: Props) {
    const { t } = useTranslation();
    const docs = tagDocs(language);
    // 表示する種類 (開くたびに SSML から)
    const [group, setGroup] = React.useState<TagGroup>('ssml');
    React.useEffect(() => {
        if (open) setGroup('ssml');
    }, [open]);

    // 一覧の内容を Markdown のファイルに保存する
    const saveToFile = async () => {
        const target = await window.kuraToolkit.dialog.saveFile({
            // 既定の名前は表示言語に関わらず英数字にする (日本語の名前を勝手に付けない)
            defaultPath: `control-tags-${language}.md`,
            filters: [{ name: t('voice.fileFilters.markdown'), extensions: ['md'] }],
        });
        if (!target) return;
        try {
            await window.kuraToolkit.voice.tts.saveText(target, tagListMarkdown(t, language));
            showNotice('success', t('voice.tags.saved'));
        } catch (error) {
            showNotice('error', voiceErrorMessage(t, error));
        }
    };

    const renderDoc = (doc: TagDoc) => (
        <Box key={doc.tag}>
            <Typography variant='subtitle2' sx={{ fontFamily: 'Consolas, Menlo, monospace' }}>
                {`<${doc.tag}>`}
            </Typography>
            <Typography variant='body2' sx={{ lineHeight: 1.6, mb: 1, whiteSpace: 'pre-line' }}>
                {t(doc.descriptionKey)}
            </Typography>
            {doc.attributes.map(attribute => (
                <Typography key={attribute.name} variant='body2' color='text.secondary' sx={{ lineHeight: 1.6 }}>
                    <Box component='span' sx={{ fontFamily: 'Consolas, Menlo, monospace', color: 'text.primary' }}>
                        {attribute.name}
                    </Box>
                    : {t(attribute.formatKey)}
                </Typography>
            ))}
            <Stack spacing={0.5} sx={{ mt: 1 }}>
                {doc.examples.map(example => (
                    <Stack key={example.before} direction='row' spacing={1} sx={{ alignItems: 'center' }}>
                        <Box
                            sx={{
                                fontFamily: 'Consolas, Menlo, monospace',
                                fontSize: '0.85rem',
                                bgcolor: 'action.hover',
                                borderRadius: 1,
                                px: 1,
                                py: 0.5,
                                flexGrow: 1,
                                overflowX: 'auto',
                                whiteSpace: 'pre',
                            }}
                        >
                            {exampleText(example)}
                        </Box>
                        <Button
                            size='small'
                            variant='outlined'
                            onClick={() => {
                                onInsert(example);
                                onClose();
                            }}
                        >
                            {example.after ? t('voice.tags.wrap') : t('voice.tags.insert')}
                        </Button>
                    </Stack>
                ))}
            </Stack>
        </Box>
    );

    return (
        <AppDialog open={open} onClose={onClose} maxWidth='md' fullWidth>
            <DialogTitle>{t('voice.tags.title')}</DialogTitle>
            <Box sx={{ px: 3 }}>
                <Typography variant='body2' color='text.secondary' sx={{ lineHeight: 1.6 }}>
                    {t('voice.tags.intro')}
                </Typography>
                <Tabs value={group} onChange={(_event, value: TagGroup) => setGroup(value)}>
                    {TAG_GROUPS.map(item => (
                        <Tab
                            key={item}
                            value={item}
                            id={`tag-group-tab-${item}`}
                            aria-controls={`tag-group-panel-${item}`}
                            label={t(`voice.tags.groups.${item}`)}
                        />
                    ))}
                </Tabs>
            </Box>
            {/* 種類ごとにスクロール枠を持たせ、同じ場所に重ねて描く。表示中でない種類は見えなくするだけにする
                (display: none にするとスクロール位置が失われるため)。見えない種類は操作も読み上げもさせない (inert) */}
            <DialogContent
                dividers
                sx={{
                    p: 0,
                    minHeight: 0,
                    overflow: 'hidden',
                    display: 'grid',
                    gridTemplate: 'minmax(0, 1fr) / minmax(0, 1fr)',
                }}
            >
                {TAG_GROUPS.map(item => {
                    const active = item === group;
                    return (
                        <Box
                            key={item}
                            role='tabpanel'
                            id={`tag-group-panel-${item}`}
                            aria-labelledby={`tag-group-tab-${item}`}
                            inert={!active}
                            sx={{
                                gridArea: '1 / 1',
                                overflowY: 'auto',
                                px: 3,
                                py: 2,
                                visibility: active ? 'visible' : 'hidden',
                            }}
                        >
                            <Stack spacing={2} divider={<Divider flexItem />}>
                                {docs.filter(doc => doc.group === item).map(renderDoc)}
                                <Box>
                                    <Typography variant='subtitle2'>{t('voice.tags.escapeTitle')}</Typography>
                                    <Typography variant='body2' sx={{ lineHeight: 1.6, whiteSpace: 'pre-line' }}>
                                        {t('voice.tags.escape')}
                                    </Typography>
                                </Box>
                            </Stack>
                        </Box>
                    );
                })}
            </DialogContent>
            <DialogActions sx={{ justifyContent: 'space-between' }}>
                <Button startIcon={<SaveAltIcon />} onClick={() => void saveToFile()}>
                    {t('voice.tags.saveToFile')}
                </Button>
                <Button onClick={onClose}>{t('common.close')}</Button>
            </DialogActions>
        </AppDialog>
    );
}
