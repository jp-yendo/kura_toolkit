import { Box, Button, DialogActions, DialogContent, DialogTitle, Divider, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import AppDialog from '../common/AppDialog';
import type { VoiceLanguage } from '@shared/voice/languages';

type TagExample = {
    // 選択範囲の前に入れる文字列 (after が無い場合はカーソル位置に挿入する)
    before: string;
    after?: string;
    // 選択範囲が無いときに挟む文字列
    placeholder?: string;
};

type TagDoc = {
    tag: string;
    descriptionKey: string;
    attributes: { name: string; formatKey: string }[];
    examples: TagExample[];
};

function tagDocs(language: VoiceLanguage): TagDoc[] {
    const ja = language === 'ja';
    return [
        {
            tag: 'break',
            descriptionKey: 'voice.tags.break.description',
            attributes: [
                { name: 'time', formatKey: 'voice.tags.break.time' },
                { name: 'strength', formatKey: 'voice.tags.break.strength' },
            ],
            examples: [{ before: '<break time="500ms"/>' }, { before: '<break strength="strong"/>' }],
        },
        {
            tag: 'prosody',
            descriptionKey: 'voice.tags.prosody.description',
            attributes: [
                { name: 'rate', formatKey: 'voice.tags.prosody.rate' },
                { name: 'pitch', formatKey: 'voice.tags.prosody.pitch' },
                { name: 'volume', formatKey: 'voice.tags.prosody.volume' },
            ],
            examples: [
                {
                    before: '<prosody rate="120%">',
                    after: '</prosody>',
                    placeholder: ja ? 'ここを速く' : 'faster here',
                },
                {
                    before: '<prosody pitch="+2st">',
                    after: '</prosody>',
                    placeholder: ja ? 'ここを高く' : 'higher here',
                },
                {
                    before: '<prosody volume="-6dB">',
                    after: '</prosody>',
                    placeholder: ja ? 'ここを小さく' : 'quieter here',
                },
            ],
        },
        {
            tag: 'sub',
            descriptionKey: 'voice.tags.sub.description',
            attributes: [{ name: 'alias', formatKey: 'voice.tags.sub.alias' }],
            examples: [
                ja
                    ? { before: '<sub alias="ダブリューエイチオー">', after: '</sub>', placeholder: 'WHO' }
                    : { before: '<sub alias="World Health Organization">', after: '</sub>', placeholder: 'WHO' },
            ],
        },
        {
            tag: 'phoneme',
            descriptionKey: ja ? 'voice.tags.phoneme.descriptionJa' : 'voice.tags.phoneme.descriptionEn',
            attributes: [
                { name: 'ph', formatKey: ja ? 'voice.tags.phoneme.phJa' : 'voice.tags.phoneme.phEn' },
                { name: 'alphabet', formatKey: 'voice.tags.phoneme.alphabet' },
            ],
            examples: ja
                ? [
                      { before: `<phoneme ph="ハ'シ">`, after: '</phoneme>', placeholder: '箸' },
                      { before: `<phoneme ph="ハシ'">`, after: '</phoneme>', placeholder: '橋' },
                      {
                          before: `<phoneme ph="キョ'ウワ/イ'イ/テンキ">`,
                          after: '</phoneme>',
                          placeholder: '今日はいい天気',
                      },
                  ]
                : [{ before: '<phoneme alphabet="ipa" ph="təˈmɑːtoʊ">', after: '</phoneme>', placeholder: 'tomato' }],
        },
    ];
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
    return (
        <AppDialog open={open} onClose={onClose} maxWidth='md' fullWidth>
            <DialogTitle>{t('voice.tags.title')}</DialogTitle>
            <DialogContent dividers>
                <Typography variant='body2' color='text.secondary' sx={{ mb: 2, lineHeight: 1.6 }}>
                    {t('voice.tags.intro')}
                </Typography>
                <Stack spacing={2} divider={<Divider flexItem />}>
                    {docs.map(doc => (
                        <Box key={doc.tag}>
                            <Typography variant='subtitle2' sx={{ fontFamily: 'Consolas, Menlo, monospace' }}>
                                {`<${doc.tag}>`}
                            </Typography>
                            <Typography variant='body2' sx={{ lineHeight: 1.6, mb: 1, whiteSpace: 'pre-line' }}>
                                {t(doc.descriptionKey)}
                            </Typography>
                            {doc.attributes.map(attribute => (
                                <Typography
                                    key={attribute.name}
                                    variant='body2'
                                    color='text.secondary'
                                    sx={{ lineHeight: 1.6 }}
                                >
                                    <Box
                                        component='span'
                                        sx={{ fontFamily: 'Consolas, Menlo, monospace', color: 'text.primary' }}
                                    >
                                        {attribute.name}
                                    </Box>
                                    : {t(attribute.formatKey)}
                                </Typography>
                            ))}
                            <Stack spacing={0.5} sx={{ mt: 1 }}>
                                {doc.examples.map(example => (
                                    <Stack
                                        key={example.before}
                                        direction='row'
                                        spacing={1}
                                        sx={{ alignItems: 'center' }}
                                    >
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
                                            {`${example.before}${example.after ? `${example.placeholder ?? ''}${example.after}` : ''}`}
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
                    ))}
                    <Box>
                        <Typography variant='subtitle2'>{t('voice.tags.escapeTitle')}</Typography>
                        <Typography variant='body2' sx={{ lineHeight: 1.6, whiteSpace: 'pre-line' }}>
                            {t('voice.tags.escape')}
                        </Typography>
                    </Box>
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>{t('common.close')}</Button>
            </DialogActions>
        </AppDialog>
    );
}
