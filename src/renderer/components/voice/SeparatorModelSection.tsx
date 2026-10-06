import React from 'react';
import {
    Alert,
    Button,
    Checkbox,
    Chip,
    CircularProgress,
    FormControl,
    FormControlLabel,
    InputAdornment,
    InputLabel,
    MenuItem,
    Select,
    Stack,
    Tab,
    TableCell,
    TableRow,
    Tabs,
    ToggleButton,
    ToggleButtonGroup,
    TextField,
    Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { useTranslation } from 'react-i18next';
import Panel from '../common/Panel';
import LibraryItemTable, { ItemRow, LibraryTableShell } from './LibraryItemTable';
import { itemLabel, requirementRows, type RequirementRow } from './libraryItems';
import { SEPARATOR_ARCH_LABELS, separatorNoteKey, separatorOutputs } from './separatorModelNotes';
import { formatBytes } from './voiceFormat';
import { SEPARATOR_PURPOSES } from './separatorPurposes';
import { compareSeparatorModels, SEPARATION_CATEGORIES } from './separatorCategories';
import { SEPARATOR_MODEL_PREFIX, type RequirementGroup } from '@shared/voice/requirements';
import type {
    LibraryItem,
    LibraryProgress,
    LibraryStatus,
    SeparationArch,
    SeparationCategory,
    SeparatorEnsembleInfo,
} from '@shared/voice/types';

const SEPARATION_ARCHS: SeparationArch[] = ['MDXC', 'MDX', 'VR', 'Demucs'];

const captionSx = { display: 'block', lineHeight: 1.5 } as const;

// 表示する行 (組み合わせの行とその下のモデル、または単体のモデルの行)
type PurposeRow =
    | { key: string; row: RequirementRow }
    | {
          key: string;
          ensemble: SeparatorEnsembleInfo;
          labelKey?: string;
          models: LibraryItem[];
          rows: RequirementRow[];
      };

// 並べる順: 分離の品質 (出力のうち最も高い値) が高いモデル、名前の順 (分離の画面と同じ)
function compareModels(a: LibraryItem, b: LibraryItem): number {
    return compareSeparatorModels(
        { name: a.name ?? '', sdr: a.separator?.sdr },
        { name: b.name ?? '', sdr: b.separator?.sdr }
    );
}

type EnsembleRowProps = {
    ensemble: SeparatorEnsembleInfo;
    labelKey?: string;
    models: LibraryItem[];
    selectedCount: number;
    selectMany(ids: string[], on: boolean): void;
};

// おすすめの組み合わせの 1 行。選ぶと、組み合わせるモデル (この行の下に並べる) をすべて選ぶ
const EnsembleRow = React.memo(function EnsembleRow({
    ensemble,
    labelKey,
    models,
    selectedCount,
    selectMany,
}: EnsembleRowProps) {
    const { t } = useTranslation();
    const installed = models.filter(item => item.status === 'installed').length;
    const all = selectedCount === models.length && models.length > 0;
    const descriptionKey = `voice.library.separatorEnsembleDescriptions.${ensemble.id}`;
    const size = models.reduce((sum, item) => sum + (item.sizeBytes ?? 0), 0);
    return (
        <TableRow hover>
            <TableCell padding='checkbox'>
                <Checkbox
                    size='small'
                    checked={all}
                    indeterminate={selectedCount > 0 && !all}
                    disabled={models.length === 0 || models.some(item => !item.available)}
                    onChange={() =>
                        selectMany(
                            models.map(item => item.id),
                            !all
                        )
                    }
                    slotProps={{ input: { 'aria-label': ensemble.name } }}
                />
            </TableCell>
            <TableCell>
                <Typography variant='body2' sx={{ fontWeight: 600 }}>
                    {ensemble.name}
                </Typography>
                {labelKey && (
                    <Typography variant='caption' color='primary' sx={captionSx}>
                        {t(labelKey)}
                    </Typography>
                )}
                <Typography variant='caption' color='text.secondary' sx={captionSx}>
                    {t(descriptionKey)}
                </Typography>
            </TableCell>
            <TableCell sx={{ whiteSpace: 'nowrap' }} align='right'>
                <Typography variant='body2'>{formatBytes(size)}</Typography>
            </TableCell>
            <TableCell sx={{ whiteSpace: 'nowrap' }}>
                <Chip
                    size='small'
                    color={installed === models.length ? 'success' : 'default'}
                    label={t(`voice.library.status.${installed === models.length ? 'installed' : 'missing'}`)}
                />
                {installed > 0 && installed < models.length && (
                    <Typography variant='caption' color='text.secondary' sx={captionSx}>
                        {t('voice.library.separatorEnsemblePartial', { installed, total: models.length })}
                    </Typography>
                )}
            </TableCell>
            <TableCell />
            <TableCell padding='checkbox' />
        </TableRow>
    );
});

type Props = {
    group: RequirementGroup;
    status: LibraryStatus;
    items: LibraryItem[];
    // 開いたときに表示する分離の種類 (呼び出し元が選んだモデルの種類)
    initialCategory: SeparationCategory;
    selected: Set<string>;
    toggle(id: string): void;
    selectMany(ids: string[], on: boolean): void;
    onRemove(ids: string[]): void;
    progress: Record<string, LibraryProgress>;
    // 分離モデルの一覧を作れなかったときのエラー
    listError: string | null;
    onRetryList(): void;
};

// ダウンロードの画面の分離モデル。目的別のおすすめと、分離の種類ごとのモデルの一覧を示す
export default function SeparatorModelSection({
    group,
    status,
    items,
    initialCategory,
    selected,
    toggle,
    selectMany,
    onRemove,
    progress,
    listError,
    onRetryList,
}: Props) {
    const { t } = useTranslation();
    const [category, setCategory] = React.useState<SeparationCategory>(initialCategory);
    const [search, setSearch] = React.useState('');
    const [installedOnly, setInstalledOnly] = React.useState(false);
    const [archFilter, setArchFilter] = React.useState<SeparationArch | 'all'>('all');
    const [outputFilter, setOutputFilter] = React.useState<string>('all');
    const [purposeId, setPurposeId] = React.useState(SEPARATOR_PURPOSES[0].id);

    const byId = React.useMemo(() => new Map(items.map(item => [item.id, item])), [items]);
    const allModels = React.useMemo(
        () => items.filter(item => item.kind === 'model' && item.separator).sort(compareModels),
        [items]
    );
    const categoryCounts = React.useMemo(() => {
        const counts = new Map<SeparationCategory, number>();
        for (const item of allModels) {
            const value = item.separator?.category as SeparationCategory;
            counts.set(value, (counts.get(value) ?? 0) + 1);
        }
        return counts;
    }, [allModels]);
    const inCategory = React.useMemo(
        () => allModels.filter(item => item.separator?.category === category),
        [allModels, category]
    );
    // 絞り込みの選択肢は、選んでいる種類のモデルにあるものだけ
    const archOptions = React.useMemo(
        () => SEPARATION_ARCHS.filter(arch => inCategory.some(item => item.separator?.arch === arch)),
        [inCategory]
    );
    const outputOptions = React.useMemo(
        () => [...new Set(inCategory.flatMap(separatorOutputs))].sort((a, b) => a.localeCompare(b)),
        [inCategory]
    );
    const arch = archFilter !== 'all' && archOptions.includes(archFilter) ? archFilter : 'all';
    const output = outputFilter !== 'all' && outputOptions.includes(outputFilter) ? outputFilter : 'all';
    const rows = React.useMemo(() => {
        const keyword = search.trim().toLowerCase();
        // 名前・概要・出力のどれかに含まれるものを探す
        const matches = (item: LibraryItem) => {
            if (!keyword) return true;
            const note = separatorNoteKey(item);
            const text = [itemLabel(t, item), note ? t(note) : '', ...separatorOutputs(item)].join('\n').toLowerCase();
            return text.includes(keyword);
        };
        const models = inCategory
            .filter(item => !installedOnly || item.status === 'installed')
            .filter(item => arch === 'all' || item.separator?.arch === arch)
            .filter(item => output === 'all' || separatorOutputs(item).includes(output))
            .filter(matches);
        return requirementRows(group, models);
    }, [inCategory, group, search, installedOnly, arch, output, t]);
    // 目的別のおすすめは常にすべて示す (絞り込みは個別のモデルの一覧だけに効く)。一覧に無い組み合わせ・モデルは示さない
    const purposes = React.useMemo(() => {
        const ensembleById = new Map(status.separatorEnsembles.map(ensemble => [ensemble.id, ensemble]));
        return SEPARATOR_PURPOSES.map(purpose => ({
            id: purpose.id,
            entries: purpose.entries.flatMap((entry): PurposeRow[] => {
                if (entry.kind === 'model') {
                    const item = byId.get(`${SEPARATOR_MODEL_PREFIX}${entry.filename}`);
                    const row: RequirementRow | null = item
                        ? { key: item.id, item, depth: 0, prerequisites: [] }
                        : null;
                    return row ? [{ key: entry.filename, row }] : [];
                }
                const ensemble = ensembleById.get(entry.id);
                if (!ensemble) return [];
                const models = ensemble.models.map(id => byId.get(id)).filter((item): item is LibraryItem => !!item);
                // 組み合わせるモデルは、組み合わせの行の下に 1 段下げて並べる
                const rows: RequirementRow[] = models.map(item => ({
                    key: `${ensemble.id}>${item.id}`,
                    item,
                    depth: 1,
                    prerequisites: [],
                }));
                return [{ key: ensemble.id, ensemble, labelKey: entry.labelKey, models, rows }];
            }),
        })).filter(purpose => purpose.entries.length > 0);
    }, [status.separatorEnsembles, byId]);
    // 表示中の目的のタブ (一覧に無い目的を指していれば先頭)
    const activePurpose = purposes.find(purpose => purpose.id === purposeId) ?? purposes[0];

    if (!status.separatorModelsListed) {
        // 一覧が無くても、取得済みの分離モデルは削除できるよう示す
        const unlisted = requirementRows(group, items);
        const packageInstalled = items.find(item => item.id === 'component:separator')?.status === 'installed';
        return (
            <Stack spacing={1}>
                {listError ? (
                    <Alert
                        severity='error'
                        action={
                            <Button color='inherit' size='small' onClick={onRetryList}>
                                {t('voice.common.retry')}
                            </Button>
                        }
                    >
                        {t('voice.library.separatorListFailed', { message: listError })}
                    </Alert>
                ) : (
                    <Panel>
                        {packageInstalled ? (
                            <Stack direction='row' spacing={1.5} sx={{ alignItems: 'center' }}>
                                <CircularProgress size={16} />
                                <Typography variant='body2' color='text.secondary'>
                                    {t('voice.library.separatorListCreating')}
                                </Typography>
                            </Stack>
                        ) : (
                            <Typography variant='body2' color='text.secondary' sx={{ lineHeight: 1.6 }}>
                                {t('voice.library.separatorListHint')}
                            </Typography>
                        )}
                    </Panel>
                )}
                {unlisted.length > 0 && (
                    <LibraryItemTable
                        rows={unlisted}
                        selected={selected}
                        toggle={toggle}
                        onRemove={onRemove}
                        progress={progress}
                    />
                )}
            </Stack>
        );
    }

    return (
        <Stack spacing={3}>
            {activePurpose && (
                <Stack spacing={1.5}>
                    <Stack spacing={0.5}>
                        <Typography variant='subtitle1' sx={{ fontWeight: 700 }}>
                            {t('voice.library.separatorRecommendations')}
                        </Typography>
                        <Typography variant='body2' color='text.secondary' sx={{ lineHeight: 1.6 }}>
                            {t('voice.library.separatorRecommendationsNote')}
                        </Typography>
                    </Stack>
                    <Tabs
                        value={activePurpose.id}
                        onChange={(_event, value: string) => setPurposeId(value)}
                        variant='scrollable'
                        scrollButtons='auto'
                        sx={{ borderBottom: 1, borderColor: 'divider', minHeight: 40 }}
                    >
                        {purposes.map(purpose => (
                            <Tab
                                key={purpose.id}
                                value={purpose.id}
                                label={t(`voice.library.separatorPurposes.${purpose.id}.title`)}
                                sx={{ minHeight: 40 }}
                            />
                        ))}
                    </Tabs>
                    <Stack spacing={0.5}>
                        {/* 補足は、2 回に分けて分離する目的のように、手順の説明が要るものだけが持つ */}
                        {t(`voice.library.separatorPurposes.${activePurpose.id}.note`, { defaultValue: '' }) && (
                            <Typography variant='body2' color='text.secondary' sx={{ lineHeight: 1.6 }}>
                                {t(`voice.library.separatorPurposes.${activePurpose.id}.note`)}
                            </Typography>
                        )}
                        <LibraryTableShell>
                            {activePurpose.entries.map(entry =>
                                'ensemble' in entry ? (
                                    <React.Fragment key={entry.key}>
                                        <EnsembleRow
                                            ensemble={entry.ensemble}
                                            labelKey={entry.labelKey}
                                            models={entry.models}
                                            selectedCount={entry.models.filter(item => selected.has(item.id)).length}
                                            selectMany={selectMany}
                                        />
                                        {entry.rows.map(row => (
                                            <ItemRow
                                                key={row.key}
                                                row={row}
                                                checked={selected.has(row.item.id)}
                                                toggle={toggle}
                                                onRemove={onRemove}
                                                progress={progress[row.item.id]}
                                            />
                                        ))}
                                    </React.Fragment>
                                ) : (
                                    <ItemRow
                                        key={entry.key}
                                        row={entry.row}
                                        checked={selected.has(entry.row.item.id)}
                                        toggle={toggle}
                                        onRemove={onRemove}
                                        progress={progress[entry.row.item.id]}
                                    />
                                )
                            )}
                        </LibraryTableShell>
                    </Stack>
                </Stack>
            )}

            <Stack spacing={1.5}>
                <Stack spacing={0.5}>
                    <Typography variant='subtitle1' sx={{ fontWeight: 700 }}>
                        {t('voice.library.separatorSingleModels')}
                    </Typography>
                    <Typography variant='body2' color='text.secondary' sx={{ lineHeight: 1.6 }}>
                        {t('voice.library.separatorSingleModelsNote')}
                    </Typography>
                </Stack>
                {/* 分離の種類の切り替え。幅が足りなければ折り返す */}
                <ToggleButtonGroup
                    exclusive
                    size='small'
                    value={category}
                    onChange={(_event, value: SeparationCategory | null) => value && setCategory(value)}
                    sx={{
                        flexWrap: 'wrap',
                        gap: 0.75,
                        '& .MuiToggleButtonGroup-grouped': {
                            border: 1,
                            borderColor: 'divider',
                            borderRadius: 1,
                            m: 0,
                            px: 1.5,
                            textTransform: 'none',
                        },
                        '& .MuiToggleButtonGroup-grouped:not(:first-of-type)': {
                            borderLeft: 1,
                            borderColor: 'divider',
                        },
                    }}
                >
                    {SEPARATION_CATEGORIES.filter(value => categoryCounts.has(value)).map(value => (
                        <ToggleButton key={value} value={value}>
                            {t('voice.library.separatorCategoryCount', {
                                name: t(`voice.separation.categories.${value}`),
                                count: categoryCounts.get(value),
                            })}
                        </ToggleButton>
                    ))}
                </ToggleButtonGroup>
                <Panel>
                    <Stack spacing={1.5}>
                        <Typography variant='body2' color='text.secondary' sx={{ lineHeight: 1.6 }}>
                            {t(`voice.library.separatorCategoryNotes.${category}`)}
                        </Typography>
                        <Stack direction='row' sx={{ flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
                            <FormControl size='small' sx={{ minWidth: 180 }}>
                                <InputLabel id='separator-arch'>{t('voice.library.separatorFilterArch')}</InputLabel>
                                <Select
                                    labelId='separator-arch'
                                    label={t('voice.library.separatorFilterArch')}
                                    value={arch}
                                    onChange={event => setArchFilter(event.target.value as SeparationArch | 'all')}
                                >
                                    <MenuItem value='all'>{t('voice.library.separatorFilterAll')}</MenuItem>
                                    {archOptions.map(value => (
                                        <MenuItem key={value} value={value}>
                                            {SEPARATOR_ARCH_LABELS[value]}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                            <FormControl size='small' sx={{ minWidth: 180 }}>
                                <InputLabel id='separator-output'>
                                    {t('voice.library.separatorFilterOutput')}
                                </InputLabel>
                                <Select
                                    labelId='separator-output'
                                    label={t('voice.library.separatorFilterOutput')}
                                    value={output}
                                    onChange={event => setOutputFilter(event.target.value)}
                                >
                                    <MenuItem value='all'>{t('voice.library.separatorFilterAll')}</MenuItem>
                                    {outputOptions.map(value => (
                                        <MenuItem key={value} value={value}>
                                            {value}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                            <TextField
                                size='small'
                                placeholder={t('voice.library.searchModels')}
                                value={search}
                                onChange={event => setSearch(event.target.value)}
                                sx={{ minWidth: 260, flexGrow: 1, maxWidth: 420 }}
                                slotProps={{
                                    input: {
                                        startAdornment: (
                                            <InputAdornment position='start'>
                                                <SearchIcon fontSize='small' />
                                            </InputAdornment>
                                        ),
                                    },
                                }}
                            />
                            <FormControlLabel
                                control={
                                    <Checkbox
                                        size='small'
                                        checked={installedOnly}
                                        onChange={(_e, value) => setInstalledOnly(value)}
                                    />
                                }
                                label={t('voice.library.installedOnly')}
                            />
                        </Stack>
                        {rows.length === 0 ? (
                            <Typography variant='body2' color='text.secondary'>
                                {t('voice.library.separatorNoMatch')}
                            </Typography>
                        ) : (
                            <LibraryItemTable
                                rows={rows}
                                selected={selected}
                                toggle={toggle}
                                onRemove={onRemove}
                                progress={progress}
                            />
                        )}
                    </Stack>
                </Panel>
            </Stack>
        </Stack>
    );
}
