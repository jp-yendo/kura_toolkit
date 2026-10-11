import {
    Box,
    Button,
    IconButton,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    TextField,
    Tooltip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import { useTranslation } from 'react-i18next';
import Panel from '../common/Panel';
import { TAG_FIELDS, tagKeyError, useVideoTrackTagStore } from '../../stores/videoTrackTagStore';

// タグ: ファイル全体のタグを編集する。よく使うタグ (タイトル・アーティスト・説明など) は欄で、ほかのタグは一覧で
// 名前と値を編集・追加・削除する
export default function TagsTab() {
    const { t } = useTranslation();
    const tags = useVideoTrackTagStore(state => state.tags);
    const { addTag, setFieldTag, updateTag, removeTag } = useVideoTrackTagStore.getState();
    const others = tags.filter(tag => !tag.field);
    return (
        <Box>
            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                    gap: 2,
                    pt: 1,
                    mb: 3,
                }}
            >
                {TAG_FIELDS.map(field => (
                    <TextField
                        key={field.key}
                        size='small'
                        label={t(`videoTrackTagPage.tagFields.${field.key}`)}
                        value={tags.find(tag => tag.field && tag.key.toLowerCase() === field.key)?.value ?? ''}
                        onChange={event => setFieldTag(field.key, event.target.value)}
                        multiline={field.multiline}
                        minRows={field.multiline ? 2 : undefined}
                        maxRows={field.multiline ? 6 : undefined}
                        sx={field.multiline ? { gridColumn: '1 / -1' } : undefined}
                    />
                ))}
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
                <Button size='small' startIcon={<AddIcon />} onClick={addTag}>
                    {t('videoTrackTagPage.addTag')}
                </Button>
            </Box>
            <Panel disablePadding>
                <Table size='small'>
                    <TableHead>
                        <TableRow>
                            <TableCell sx={{ width: '30%' }}>{t('videoTrackTagPage.colTagKey')}</TableCell>
                            <TableCell>{t('videoTrackTagPage.colTagValue')}</TableCell>
                            <TableCell padding='checkbox' />
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {others.map(tag => (
                            <TableRow key={tag.id}>
                                <TableCell>
                                    <TextField
                                        size='small'
                                        fullWidth
                                        value={tag.key}
                                        error={tagKeyError(tags, tag) !== null}
                                        helperText={
                                            ['duplicate', 'reserved', 'field'].includes(tagKeyError(tags, tag) ?? '')
                                                ? t(`videoTrackTagPage.tagKey.${tagKeyError(tags, tag)}`)
                                                : undefined
                                        }
                                        onChange={event => updateTag(tag.id, { key: event.target.value })}
                                        slotProps={{ htmlInput: { 'aria-label': t('videoTrackTagPage.colTagKey') } }}
                                    />
                                </TableCell>
                                <TableCell>
                                    <TextField
                                        size='small'
                                        fullWidth
                                        multiline
                                        maxRows={6}
                                        value={tag.value}
                                        onChange={event => updateTag(tag.id, { value: event.target.value })}
                                        slotProps={{ htmlInput: { 'aria-label': t('videoTrackTagPage.colTagValue') } }}
                                    />
                                </TableCell>
                                <TableCell padding='checkbox'>
                                    <Tooltip title={t('videoTrackTagPage.removeTag')}>
                                        <IconButton
                                            aria-label={t('videoTrackTagPage.removeTag')}
                                            size='small'
                                            onClick={() => removeTag(tag.id)}
                                        >
                                            <DeleteIcon fontSize='small' />
                                        </IconButton>
                                    </Tooltip>
                                </TableCell>
                            </TableRow>
                        ))}
                        {others.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={3} sx={{ color: 'text.secondary' }}>
                                    {t('videoTrackTagPage.noTags')}
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </Panel>
        </Box>
    );
}
