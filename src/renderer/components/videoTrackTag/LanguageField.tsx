import React from 'react';
import { Autocomplete, TextField, createFilterOptions } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { ISO639_LANGUAGES } from '@shared/iso639';
import { languageName, languageOf } from './trackTagFormat';

type Props = {
    // 言語のコード (ISO 639-2 の 3 文字。空 = 指定なし)
    value: string;
    disabled?: boolean;
    onChange(value: string): void;
};

// トラックの言語。ISO 639-2 のすべての言語から、表示名・英語の名前・コードで検索して選ぶ (一覧に無いコードも 3 文字なら入力できる)
export default function LanguageField({ value, disabled, onChange }: Props) {
    const { t, i18n } = useTranslation();
    const label = React.useCallback(
        (code: string) => {
            if (!code) return t('videoTrackTagPage.languageNone');
            const name = languageName(code, i18n.language);
            return name === code ? code : `${name} (${code})`;
        },
        [t, i18n.language]
    );
    // 指定なしを先頭に、表示名の順に並べる
    const options = React.useMemo(() => {
        const collator = new Intl.Collator(i18n.language);
        const codes = ISO639_LANGUAGES.map(language => language.code);
        return ['', ...codes.sort((a, b) => collator.compare(label(a), label(b)))];
    }, [i18n.language, label]);
    // 表示名に加え、英語の名前と、もう一方のコード (B・T) でも当たるようにする
    const searchText = React.useCallback(
        (code: string) => {
            const entry = languageOf(code);
            return [label(code), entry?.english ?? '', entry?.terminology ?? ''].join(' ');
        },
        [label]
    );
    const filter = React.useMemo(() => createFilterOptions<string>({ stringify: searchText }), [searchText]);
    // 確定した入力 (候補を選ばずに入力欄から離れた・Enter を押した場合は打った文字のまま渡る) を言語のコードにする:
    // 候補の表示名・「(コード)」で終わる文字・3 文字のコード (T は B にそろえる)・言語の名前と一致するものはその言語、
    // それ以外は検索して最初に当たった言語。どれにも当たらなければ打った文字のまま (誤りとして示す)
    const codeOf = (text: string) => {
        const trimmed = text.trim();
        if (trimmed === '') return '';
        const listed = options.find(code => label(code) === trimmed);
        if (listed !== undefined) return listed;
        const lower = trimmed.toLowerCase();
        const code = /\(([a-zA-Z]{3})\)$/.exec(trimmed)?.[1]?.toLowerCase() ?? lower;
        if (code === 'und') return '';
        const byCode = /^[a-z]{3}$/.test(code) ? languageOf(code) : undefined;
        if (byCode) return byCode.code;
        const byName = ISO639_LANGUAGES.find(
            entry =>
                entry.english.toLowerCase() === lower || languageName(entry.code, i18n.language).toLowerCase() === lower
        );
        if (byName) return byName.code;
        const searched = options.find(option => option !== '' && searchText(option).toLowerCase().includes(lower));
        return searched ?? lower;
    };
    // 入力欄の文字は、決まった言語の表示名にそろえる (同じ言語に決まった場合も、打った文字を残さない)
    const [inputValue, setInputValue] = React.useState(() => label(value));
    React.useEffect(() => setInputValue(label(value)), [value, label]);
    return (
        <Autocomplete
            size='small'
            disabled={disabled}
            freeSolo
            autoSelect
            autoHighlight
            selectOnFocus
            handleHomeEndKeys
            options={options}
            filterOptions={filter}
            value={value}
            getOptionLabel={label}
            inputValue={inputValue}
            onInputChange={(_event, next) => setInputValue(next)}
            onChange={(_event, next) => {
                const code = codeOf(next ?? '');
                onChange(code);
                setInputValue(label(code));
            }}
            sx={{ minWidth: 220 }}
            renderInput={params => (
                <TextField
                    {...params}
                    error={value !== '' && !/^[a-z]{3}$/.test(value)}
                    slotProps={{
                        ...params.slotProps,
                        htmlInput: { ...params.slotProps.htmlInput, 'aria-label': t('videoTrackTagPage.colLanguage') },
                    }}
                />
            )}
        />
    );
}
