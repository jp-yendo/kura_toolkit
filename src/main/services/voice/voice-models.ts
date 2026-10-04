import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { shell } from 'electron';
import { extractZip, readZipText, writeZip } from './archive';
import { isItemInstalled, removeItems } from './library';
import { writeJsonFile } from './json-file';
import { modelPaths } from './paths';
import { getWorker, stopWorker } from './python-worker';
import { JVNV_PRESET_NAMES, presetItemId, TTS_ENGINE_ITEMS, TTS_PRESET_DIR } from './spec';
import { removeTemp } from '../work-dir';
import { renameWithRetry } from '../../utils/rename-retry';
import { languagesForEngine, type TtsEngineId, type VoiceLanguage } from '../../../shared/voice/languages';
import type {
    ImportCandidate,
    ImportChoices,
    ImportInspection,
    RvcModelMeta,
    TtsModelMeta,
    VoiceModelCategory,
    VoiceModelFeature,
    VoiceModelInfo,
} from '../../../shared/voice/types';

// 声のモデルの管理 (音声変換 = RVC、読み上げ = Style-Bert-VITS2)。
// 利用者が学習・取り込みしたモデルは再ダウンロードできない利用者のデータのため、ダウンロード物とは分けて
// <モデルディレクトリ>/audio/<conversion|tts>/voices/<ID>/ に置き、meta.json に名前・区分などを記録する。
// 作成中のモデル (学習・取り込みの確定) は同じ場所の .staging-<ID>/ に作り、meta.json を書いてから
// <ID>/ に名前を変える (作りかけのものを声のモデルとして扱わないため)。
// 読み上げのプリセット (JVNV) はダウンロード物として audio/tts/presets/ に置き、名前と言語の変更だけをここで記録する。

const VOICE_FILE_EXTENSION = 'kuravoice';
const VOICE_FILE_FORMAT = 'kura-voice';
const VOICE_FILE_MANIFEST = 'kura-voice.json';
const META_FILE = 'meta.json';
const PRESET_OVERRIDES_FILE = 'preset-overrides.json';
// 声のモデルの置き場にある、声のモデルではないフォルダの名前の接頭辞 (一覧に出さない)。
// 取り込みの展開先と、作成中の声のモデル
const IMPORT_STAGING_PREFIX = '.import-';
const VOICE_STAGING_PREFIX = '.staging-';

// 機能ごとのモデルを構成するファイル (書き出しに含めるもの)
const MODEL_FILES: Record<VoiceModelFeature, string[]> = {
    converter: ['model.safetensors', 'model.json', 'model.index'],
    tts: ['config.json', 'model.safetensors', 'style_vectors.npy'],
};

// Hugging Face のモデル検索 (各機能が扱う形式の検索語とタグで絞り込んで開く)
const HUB_SEARCH: Record<VoiceModelFeature, { url: string; search: string; tags: string[] }> = {
    converter: { url: 'https://huggingface.co/models', search: 'RVC', tags: ['rvc'] },
    tts: { url: 'https://huggingface.co/models', search: 'Style-Bert-VITS2', tags: ['style-bert-vits2'] },
};

export function hubSearchUrl(feature: VoiceModelFeature): string {
    const config = HUB_SEARCH[feature];
    const params = new URLSearchParams();
    for (const tag of config.tags) params.append('other', tag);
    params.set('search', config.search);
    return `${config.url}?${params.toString()}`;
}

type PresetOverride = { name?: string; languages?: VoiceLanguage[] };

function voicesDir(feature: VoiceModelFeature): string {
    return modelPaths().voices(feature);
}

function checkVoiceId(id: string): string {
    if (!/^[A-Za-z0-9-]+$/.test(id)) throw new Error('INVALID_VOICE_ID');
    return id;
}

function voiceDir(feature: VoiceModelFeature, id: string): string {
    return path.join(voicesDir(feature), checkVoiceId(id));
}

function voiceStagingDir(feature: VoiceModelFeature, id: string): string {
    return path.join(voicesDir(feature), `${VOICE_STAGING_PREFIX}${checkVoiceId(id)}`);
}

function isStagingName(name: string): boolean {
    return name.startsWith(IMPORT_STAGING_PREFIX) || name.startsWith(VOICE_STAGING_PREFIX);
}

// 起動時に、前回の起動で作りかけのまま残ったもの (取り込みの展開先・作成中の声のモデル) を裏で消す。
// アプリは 1 つしか起動しないため、起動時にあるものはすべて前回の残り物
export function removeVoiceStagingLeftovers(): void {
    for (const feature of ['converter', 'tts'] as const) {
        const dir = voicesDir(feature);
        let names: string[];
        try {
            names = fs.readdirSync(dir);
        } catch {
            continue;
        }
        for (const name of names) {
            if (isStagingName(name)) void removeTemp(path.join(dir, name));
        }
    }
}

function presetName(id: string): string | null {
    return id.startsWith('preset:') ? id.slice('preset:'.length) : null;
}

function presetDir(name: string): string {
    return path.join(modelPaths().file(TTS_PRESET_DIR), name);
}

function readJson<T>(file: string): T {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
}

// 保存してあるデータのファイル (JSON) を読む。読めない・解析できない場合は壊れたものとして扱う。
// ifMissing を渡した場合は、ファイルが無いときだけその値を返す
function readDataFile<T extends object>(file: string, ifMissing?: T): T {
    let data: unknown;
    try {
        data = readJson<unknown>(file);
    } catch (error) {
        if (ifMissing !== undefined && (error as NodeJS.ErrnoException).code === 'ENOENT') return ifMissing;
        throw new Error(`DATA_FILE_CORRUPT: ${file}`, { cause: error });
    }
    if (typeof data !== 'object' || data === null) throw new Error(`DATA_FILE_CORRUPT: ${file}`);
    return data as T;
}

// プリセットの名前と言語の変更。どのプリセットも変更していない間はファイルが無い
function readPresetOverrides(): Record<string, PresetOverride> {
    return readDataFile<Record<string, PresetOverride>>(path.join(voicesDir('tts'), PRESET_OVERRIDES_FILE), {});
}

function writePresetOverrides(data: Record<string, PresetOverride>): void {
    writeJsonFile(path.join(voicesDir('tts'), PRESET_OVERRIDES_FILE), data);
}

// --- 設定ファイルから分かるモデルの情報 ---

type SbvConfig = {
    version?: unknown;
    model_name?: unknown;
    data?: { style2id?: Record<string, number>; spk2id?: Record<string, number>; sampling_rate?: number };
};

function sortedKeys(map: Record<string, number> | undefined, fallback: string[]): string[] {
    if (!map || typeof map !== 'object') return fallback;
    return Object.entries(map)
        .filter(([, value]) => typeof value === 'number')
        .sort((a, b) => a[1] - b[1])
        .map(([key]) => key);
}

export function ttsMetaFromConfig(config: SbvConfig): TtsModelMeta {
    // version が無い設定は JP-Extra 版として扱われる (エンジン側の既定値)
    const version = typeof config.version === 'string' ? config.version : '2.0-JP-Extra';
    const engine: TtsEngineId = version.endsWith('JP-Extra') ? 'jp-extra' : 'multilingual';
    return {
        engine,
        languages: languagesForEngine(engine),
        styles: sortedKeys(config.data?.style2id, ['Neutral']),
        speakers: sortedKeys(config.data?.spk2id, []),
        version,
    };
}

// RVC モデルの設定 (model.json。学習・取り込みのときに重みと一緒に書き出したもの) を読む。
// 必要な値が欠けている場合は、読み込めないモデルとして扱う
export function readRvcModelJson(file: string, hasIndex: boolean): RvcModelMeta {
    let meta: unknown;
    try {
        meta = readJson<unknown>(file);
    } catch (error) {
        throw new Error(`INVALID_RVC_MODEL: ${file}`, { cause: error });
    }
    const { version, sr, f0, vocoder, embedder_model: embedder, speakers } = (meta ?? {}) as Record<string, unknown>;
    if (
        typeof version !== 'string' ||
        typeof sr !== 'number' ||
        (typeof f0 !== 'number' && typeof f0 !== 'boolean') ||
        typeof vocoder !== 'string' ||
        typeof embedder !== 'string' ||
        typeof speakers !== 'number'
    ) {
        throw new Error(`INVALID_RVC_MODEL: ${file}`);
    }
    return { version, sampleRate: sr, f0: Boolean(f0), vocoder, embedder, speakers, hasIndex };
}

// safetensors の見出し (先頭 8 バイトの長さ + JSON) を確かめる。プログラムを含められない形式だが、
// 壊れたファイルや別の形式を取り込まないよう、構造だけは読み込む前に確認する
function verifySafetensors(file: string): void {
    const fd = fs.openSync(file, 'r');
    try {
        const size = fs.fstatSync(fd).size;
        const lengthBuffer = Buffer.alloc(8);
        fs.readSync(fd, lengthBuffer, 0, 8, 0);
        const headerLength = Number(lengthBuffer.readBigUInt64LE(0));
        if (headerLength <= 0 || headerLength > 100 * 1024 * 1024 || headerLength + 8 > size) {
            throw new Error('INVALID_SAFETENSORS');
        }
        const header = Buffer.alloc(headerLength);
        fs.readSync(fd, header, 0, headerLength, 8);
        const parsed = JSON.parse(header.toString('utf-8')) as Record<string, unknown>;
        if (typeof parsed !== 'object' || parsed === null) throw new Error('INVALID_SAFETENSORS');
    } catch (error) {
        if (error instanceof Error && error.message === 'INVALID_SAFETENSORS') throw error;
        throw new Error('INVALID_SAFETENSORS');
    } finally {
        fs.closeSync(fd);
    }
}

// --- 一覧・取得 ---

function presetInfo(name: string, overrides: Record<string, PresetOverride>): VoiceModelInfo {
    const dir = presetDir(name);
    const meta = ttsMetaFromConfig(readDataFile<SbvConfig>(path.join(dir, 'config.json')));
    let createdAt: number;
    try {
        createdAt = fs.statSync(dir).mtimeMs;
    } catch (error) {
        throw new Error(`DATA_FILE_CORRUPT: ${dir}`, { cause: error });
    }
    const override = overrides[name] ?? {};
    if (override.languages && meta.engine === 'multilingual') meta.languages = override.languages;
    return {
        id: `preset:${name}`,
        feature: 'tts',
        name: override.name ?? '',
        presetName: name,
        category: 'preset',
        createdAt,
        presetItemId: presetItemId(name),
        tts: meta,
    };
}

export function listVoices(feature: VoiceModelFeature): VoiceModelInfo[] {
    const result: VoiceModelInfo[] = [];
    const dir = voicesDir(feature);
    if (fs.existsSync(dir)) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (!entry.isDirectory() || isStagingName(entry.name)) continue;
            result.push(readDataFile<VoiceModelInfo>(path.join(dir, entry.name, META_FILE)));
        }
    }
    if (feature === 'tts') {
        const overrides = readPresetOverrides();
        for (const name of JVNV_PRESET_NAMES) {
            if (isItemInstalled(presetItemId(name))) result.push(presetInfo(name, overrides));
        }
    }
    return result.sort((a, b) => a.category.localeCompare(b.category) || b.createdAt - a.createdAt);
}

type ResolvedVoice = {
    info: VoiceModelInfo;
    dir: string;
};

export function getVoice(feature: VoiceModelFeature, id: string): ResolvedVoice {
    const preset = presetName(id);
    if (feature === 'tts' && preset) {
        if (!isItemInstalled(presetItemId(preset))) throw new Error('VOICE_NOT_FOUND');
        return { info: presetInfo(preset, readPresetOverrides()), dir: presetDir(preset) };
    }
    const dir = voiceDir(feature, id);
    if (!fs.existsSync(dir)) throw new Error('VOICE_NOT_FOUND');
    return { info: readDataFile<VoiceModelInfo>(path.join(dir, META_FILE)), dir };
}

// 読み上げモデルのファイル
export function ttsModelFiles(voice: ResolvedVoice): { weights: string; config: string; style: string } {
    return {
        weights: ttsWeightsFile(voice),
        config: path.join(voice.dir, 'config.json'),
        style: path.join(voice.dir, 'style_vectors.npy'),
    };
}

// 重みのファイル。プリセットは配布時のファイル名のため、拡張子で探す
function ttsWeightsFile(voice: ResolvedVoice): string {
    if (voice.info.category === 'preset') {
        const name = fs.readdirSync(voice.dir).find(item => item.endsWith('.safetensors'));
        if (!name) throw new Error(`MODEL_FILE_MISSING: ${voice.dir}`);
        return path.join(voice.dir, name);
    }
    const weights = path.join(voice.dir, 'model.safetensors');
    if (!fs.existsSync(weights)) throw new Error(`DATA_FILE_CORRUPT: ${weights}`);
    return weights;
}

// --- 名前変更・言語の変更・削除 ---

export function renameVoice(feature: VoiceModelFeature, id: string, name: string): VoiceModelInfo {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('VOICE_NAME_EMPTY');
    const preset = presetName(id);
    if (feature === 'tts' && preset) {
        // 名前は変えられるが、プリセットという区分は保持する
        const overrides = readPresetOverrides();
        overrides[preset] = { ...overrides[preset], name: trimmed };
        writePresetOverrides(overrides);
        return getVoice(feature, id).info;
    }
    const voice = getVoice(feature, id);
    const next = { ...voice.info, name: trimmed };
    writeJsonFile(path.join(voice.dir, META_FILE), next);
    return next;
}

// 多言語版の読み上げモデルが対応する言語を変える (JP-Extra 版は日本語のみ)
export function setVoiceLanguages(id: string, languages: VoiceLanguage[]): VoiceModelInfo {
    if (languages.length === 0) throw new Error('VOICE_LANGUAGES_EMPTY');
    const voice = getVoice('tts', id);
    if (voice.info.tts?.engine !== 'multilingual') throw new Error('VOICE_LANGUAGES_FIXED');
    const preset = presetName(id);
    if (preset) {
        const overrides = readPresetOverrides();
        overrides[preset] = { ...overrides[preset], languages };
        writePresetOverrides(overrides);
        return getVoice('tts', id).info;
    }
    const next: VoiceModelInfo = { ...voice.info, tts: { ...(voice.info.tts as TtsModelMeta), languages } };
    writeJsonFile(path.join(voice.dir, META_FILE), next);
    return next;
}

export async function removeVoice(feature: VoiceModelFeature, id: string): Promise<void> {
    const preset = presetName(id);
    if (feature === 'tts' && preset) {
        // プリセットはダウンロード物なので、ライブラリから削除する (再ダウンロードできる)
        await removeItems([presetItemId(preset)]);
        const overrides = readPresetOverrides();
        delete overrides[preset];
        writePresetOverrides(overrides);
        return;
    }
    // 利用者が学習・取り込みしたモデルは作り直せないため、ごみ箱に移す (戻せるようにする)。
    // ごみ箱に移せない場合 (ごみ箱の無いドライブなど) は完全に削除する
    const dir = voiceDir(feature, id);
    try {
        await shell.trashItem(dir);
    } catch (error) {
        console.warn(`failed to move ${dir} to the trash; deleting it`, error);
        await fs.promises.rm(dir, { recursive: true, force: true });
    }
}

// --- 書き出し ---

// 書き出しファイルの情報 (kura-voice.json)。取り込みで使う項目だけを持つ
// (モデルの設定は、取り込むときにモデルのファイルから読み直す)
type VoiceManifest = {
    format?: string;
    feature?: string;
    name?: string;
    category?: VoiceModelCategory;
    // 読み上げモデルが対応する言語 (多言語版は利用者が選んだもの)
    tts?: { languages?: unknown };
};

export async function exportVoice(feature: VoiceModelFeature, id: string, destPath: string): Promise<void> {
    const voice = getVoice(feature, id);
    const files: { name: string; filePath: string }[] = [];
    if (feature === 'tts') {
        const model = ttsModelFiles(voice);
        files.push(
            { name: 'config.json', filePath: model.config },
            { name: 'model.safetensors', filePath: model.weights },
            { name: 'style_vectors.npy', filePath: model.style }
        );
    } else {
        for (const name of MODEL_FILES.converter) {
            const filePath = path.join(voice.dir, name);
            if (fs.existsSync(filePath)) files.push({ name, filePath });
        }
    }
    const manifest: VoiceManifest = {
        format: VOICE_FILE_FORMAT,
        feature,
        name: voice.info.name || voice.info.presetName || id,
        category: voice.info.category,
        ...(voice.info.tts ? { tts: { languages: voice.info.tts.languages } } : {}),
    };
    await writeZip(destPath, [...files, { name: VOICE_FILE_MANIFEST, text: JSON.stringify(manifest, null, 2) }]);
}

// --- 取り込み ---

type PendingImport = {
    inspection: ImportInspection;
    feature: VoiceModelFeature;
    staging: string;
    // 取り込むファイル (外部: 元の場所、本アプリの書き出し: 展開先)
    files: Record<string, string>;
};

const pendingImports = new Map<string, PendingImport>();

// 取り込みの展開先 (保存先と同じディスクに置き、確定したら中のファイルを名前の変更で移す)
function importStagingDir(feature: VoiceModelFeature, stagingId: string): string {
    return path.join(voicesDir(feature), `${IMPORT_STAGING_PREFIX}${stagingId}`);
}

// 書き出しファイルに記録された言語を確かめる (そのエンジンが読み上げられる言語に限る)
function manifestLanguages(value: unknown, engine: TtsEngineId): VoiceLanguage[] {
    const allowed = languagesForEngine(engine);
    if (!Array.isArray(value) || value.length === 0 || !value.every(item => allowed.includes(item))) {
        throw new Error('IMPORT_INVALID_FILE');
    }
    return value as VoiceLanguage[];
}

// 渡されたパス (ファイル・フォルダ・zip) から、取り込みの候補になるファイルを集める。
// フォルダはその直下のファイル、zip は中のファイルが候補になる
async function collectCandidates(paths: string[], staging: string): Promise<ImportCandidate[]> {
    const files: ImportCandidate[] = [];
    for (const [order, input] of paths.entries()) {
        const stat = fs.statSync(input);
        if (stat.isDirectory()) {
            for (const entry of fs.readdirSync(input, { withFileTypes: true })) {
                if (entry.isFile()) files.push({ path: path.join(input, entry.name), label: entry.name });
            }
        } else if (input.toLowerCase().endsWith('.zip')) {
            const target = path.join(staging, `zip-${order}`);
            const extracted = await extractZip(input, target, name =>
                /\.(pth|index|json|safetensors|npy)$/i.test(name)
            );
            for (const file of extracted) {
                const inside = path.relative(target, file).split(path.sep).join('/');
                files.push({ path: file, label: `${path.basename(input)}/${inside}` });
            }
        } else {
            files.push({ path: input, label: path.basename(input) });
        }
    }
    return files;
}

async function inspectKuraFile(feature: VoiceModelFeature, file: string, staging: string): Promise<PendingImport> {
    const text = await readZipText(file, VOICE_FILE_MANIFEST);
    if (!text) throw new Error('IMPORT_INVALID_FILE');
    const manifest = JSON.parse(text) as VoiceManifest;
    if (manifest.format !== VOICE_FILE_FORMAT) throw new Error('IMPORT_INVALID_FILE');
    if (manifest.feature !== feature) throw new Error('IMPORT_WRONG_FEATURE');
    const allowed = new Set(MODEL_FILES[feature]);
    const extracted = await extractZip(file, staging, name => allowed.has(name));
    const files: Record<string, string> = {};
    for (const filePath of extracted) files[path.basename(filePath)] = filePath;
    for (const required of feature === 'tts' ? MODEL_FILES.tts : ['model.safetensors', 'model.json']) {
        if (!files[required]) throw new Error(`IMPORT_FILES_MISSING: ${required}`);
    }
    verifySafetensors(files['model.safetensors']);
    let rvc: RvcModelMeta | undefined;
    let tts: TtsModelMeta | undefined;
    let safe = true;
    let unsafeDetail: string | undefined;
    if (feature === 'converter') {
        rvc = readRvcModelJson(files['model.json'], !!files['model.index']);
    } else {
        tts = ttsMetaFromConfig(readJson<SbvConfig>(files['config.json']));
        if (manifest.tts?.languages !== undefined && tts.engine === 'multilingual') {
            tts.languages = manifestLanguages(manifest.tts.languages, tts.engine);
        }
        requireEngine(tts.engine);
        const result = await getWorker('tts').request<{ safe: boolean; detail?: string }>('inspect_style_vectors', {
            path: files['style_vectors.npy'],
        });
        safe = result.safe;
        unsafeDetail = result.detail;
    }
    const token = crypto.randomUUID();
    return {
        feature,
        staging,
        files,
        inspection: {
            token,
            source: 'kura',
            suggestedName: manifest.name ?? path.basename(file, path.extname(file)),
            // 本アプリで書き出したファイルは、元の区分を復元する
            category:
                manifest.category === 'trained' || manifest.category === 'preset' ? manifest.category : 'imported',
            safe,
            unsafeDetail,
            rvc,
            tts,
        },
    };
}

function requireEngine(engine: TtsEngineId): void {
    if (!isItemInstalled(TTS_ENGINE_ITEMS[engine])) throw new Error(`TTS_ENGINE_NOT_INSTALLED: ${engine}`);
}

// 選んだファイルを調べた結果 (取り込むファイルと、検査結果のうちファイルで決まる項目)
type ChoiceInspection = {
    files: Record<string, string>;
    fields: Pick<ImportInspection, 'suggestedName' | 'safe' | 'unsafeDetail' | 'rvc' | 'tts'>;
};

// 変換のモデル (.pth) とインデックスを調べる
async function inspectRvcChoice(model: string, index: string | null): Promise<ChoiceInspection> {
    const result = await getWorker('converter').request<{
        safe: boolean;
        detail?: string;
        meta?: Omit<RvcModelMeta, 'hasIndex'> & { modelName?: string };
    }>('inspect_model', { path: model });
    return {
        files: index ? { pth: model, index } : { pth: model },
        fields: {
            suggestedName: result.meta?.modelName || path.basename(model, path.extname(model)),
            safe: result.safe,
            unsafeDetail: result.detail,
            rvc: result.meta ? { ...result.meta, hasIndex: !!index } : undefined,
        },
    };
}

// 読み上げのモデル (.safetensors) を調べる。設定 (config.json) とスタイル (style_vectors.npy) は、
// この形式で名前が決まっているため、選んだファイルと同じフォルダのものを使う
async function inspectTtsChoice(weights: string): Promise<ChoiceInspection> {
    const folder = path.dirname(weights);
    const config = path.join(folder, 'config.json');
    const style = path.join(folder, 'style_vectors.npy');
    const missing = [!fs.existsSync(config) && 'config.json', !fs.existsSync(style) && 'style_vectors.npy'].filter(
        Boolean
    );
    if (missing.length > 0) throw new Error(`IMPORT_FILES_MISSING: ${missing.join(', ')}`);
    const parsedConfig = readJson<SbvConfig>(config);
    const tts = ttsMetaFromConfig(parsedConfig);
    requireEngine(tts.engine);
    verifySafetensors(weights);
    const result = await getWorker('tts').request<{ safe: boolean; detail?: string }>('inspect_style_vectors', {
        path: style,
    });
    return {
        files: { config, weights, style },
        fields: {
            suggestedName:
                typeof parsedConfig.model_name === 'string' && parsedConfig.model_name
                    ? parsedConfig.model_name
                    : path.basename(folder),
            safe: result.safe,
            unsafeDetail: result.detail,
            tts,
        },
    };
}

// 選んだファイルの組み合わせを調べ、取り込む内容をその組み合わせにする。調べられなかった場合は元のまま
async function applyChoice(pending: PendingImport, choices: ImportChoices): Promise<void> {
    const { files, fields } =
        pending.feature === 'converter'
            ? await inspectRvcChoice(choices.model, choices.index)
            : await inspectTtsChoice(choices.model);
    pending.files = files;
    pending.inspection = {
        token: pending.inspection.token,
        source: 'external',
        category: 'imported',
        choices,
        ...fields,
    };
}

function isAddedIndex(candidate: ImportCandidate): boolean {
    return path.basename(candidate.path).startsWith('added_');
}

// 外部で入手したモデル。候補が複数ある場合は、最初に選んでおくものを先頭に並べる
async function inspectExternal(feature: VoiceModelFeature, paths: string[], staging: string): Promise<PendingImport> {
    const candidates = await collectCandidates(paths, staging);
    const hasExtension = (candidate: ImportCandidate, extension: string) =>
        candidate.path.toLowerCase().endsWith(extension);
    let choices: ImportChoices;
    if (feature === 'converter') {
        // 学習途中の G_xxx.pth / D_xxx.pth は推論に使うモデルではない。大きいものを先に並べる
        const models = candidates
            .filter(item => hasExtension(item, '.pth') && !/^[GD]_\d+\.pth$/i.test(path.basename(item.path)))
            .sort((a, b) => fs.statSync(b.path).size - fs.statSync(a.path).size);
        if (models.length === 0) throw new Error('IMPORT_PTH_NOT_FOUND');
        // 推論に使うインデックス (RVC・Applio が added_ で始まる名前で作るもの) を先に並べる
        const indexes = candidates
            .filter(item => hasExtension(item, '.index'))
            .sort((a, b) => Number(isAddedIndex(b)) - Number(isAddedIndex(a)));
        choices = { models, model: models[0].path, indexes, index: indexes[0]?.path ?? null };
    } else {
        // 新しいものを先に並べる
        const models = candidates
            .filter(item => hasExtension(item, '.safetensors'))
            .sort((a, b) => fs.statSync(b.path).mtimeMs - fs.statSync(a.path).mtimeMs);
        if (models.length === 0) throw new Error('IMPORT_FILES_MISSING: *.safetensors');
        choices = { models, model: models[0].path, indexes: [], index: null };
    }
    const pending: PendingImport = {
        feature,
        staging,
        files: {},
        inspection: {
            token: crypto.randomUUID(),
            source: 'external',
            suggestedName: '',
            category: 'imported',
            safe: true,
        },
    };
    await applyChoice(pending, choices);
    return pending;
}

// 確認画面で選び直したファイルで調べ直す。選べるのは候補のファイルだけ
export async function chooseImportFiles(token: string, model: string, index: string | null): Promise<ImportInspection> {
    const pending = pendingImports.get(token);
    if (!pending) throw new Error('IMPORT_EXPIRED');
    const choices = pending.inspection.choices;
    if (!choices || !choices.models.some(item => item.path === model)) throw new Error('INVALID_PATH');
    if (index === null ? choices.indexes.length > 0 : !choices.indexes.some(item => item.path === index)) {
        throw new Error('INVALID_PATH');
    }
    await applyChoice(pending, { ...choices, model, index });
    return pending.inspection;
}

export async function inspectImport(feature: VoiceModelFeature, paths: string[]): Promise<ImportInspection> {
    if (paths.length === 0) throw new Error('IMPORT_NO_FILES');
    const stagingId = crypto.randomUUID();
    // zip や書き出しファイルは保存先と同じディスクに展開する (確定時にドライブをまたぐコピーをしないため)
    const staging = importStagingDir(feature, stagingId);
    fs.mkdirSync(staging, { recursive: true });
    try {
        const pending =
            paths.length === 1 && paths[0].toLowerCase().endsWith(`.${VOICE_FILE_EXTENSION}`)
                ? await inspectKuraFile(feature, paths[0], staging)
                : await inspectExternal(feature, paths, staging);
        pendingImports.set(pending.inspection.token, pending);
        return pending.inspection;
    } catch (error) {
        fs.rmSync(staging, { recursive: true, force: true });
        throw error;
    }
}

export function cancelImport(token: string): void {
    const pending = pendingImports.get(token);
    if (!pending) return;
    pendingImports.delete(token);
    fs.rmSync(pending.staging, { recursive: true, force: true });
}

// 取り込みを確定する。名前や言語の指定が正しくない場合は、検査の結果を残したまま失敗させる (指定し直して確定できる)
export async function commitImport(
    token: string,
    options: { name: string; allowUnsafe: boolean; languages?: VoiceLanguage[] }
): Promise<VoiceModelInfo> {
    const pending = pendingImports.get(token);
    if (!pending) throw new Error('IMPORT_EXPIRED');
    const { inspection, feature, files, staging } = pending;
    if (!inspection.safe && !options.allowUnsafe) throw new Error('IMPORT_UNSAFE_NOT_ALLOWED');
    const name = options.name.trim();
    if (!name) throw new Error('VOICE_NAME_EMPTY');
    const multilingual = inspection.tts?.engine === 'multilingual';
    if (multilingual && options.languages?.length === 0) throw new Error('VOICE_LANGUAGES_EMPTY');
    // 展開したファイルは名前の変更で移す (同じディスク)。利用者の元のファイルは残すためコピーする
    const place = (source: string, dest: string) => {
        const inside = path.resolve(source).startsWith(path.resolve(staging) + path.sep);
        if (inside) fs.renameSync(source, dest);
        else fs.copyFileSync(source, dest);
    };
    const { id, dir } = newVoiceDir(feature);
    try {
        let rvc = inspection.rvc;
        let tts = inspection.tts;
        if (feature === 'converter') {
            if (inspection.source === 'kura') {
                for (const fileName of MODEL_FILES.converter) {
                    if (files[fileName]) place(files[fileName], path.join(dir, fileName));
                }
            } else {
                // 重みと設定値だけを取り出して安全な形式で保存する。以降の変換や書き出しで危険な読み込みは起きない
                try {
                    await getWorker('converter').request('sanitize_model', {
                        path: files.pth,
                        outDir: dir,
                        allowUnsafe: options.allowUnsafe,
                    });
                } finally {
                    // 制限なしで読み込んだプロセスは、成否を問わず念のため使い続けない
                    if (!inspection.safe) stopWorker('converter');
                }
                if (files.index) place(files.index, path.join(dir, 'model.index'));
                rvc = readRvcModelJson(path.join(dir, 'model.json'), !!files.index);
            }
        } else {
            const config = inspection.source === 'kura' ? files['config.json'] : files.config;
            const weights = inspection.source === 'kura' ? files['model.safetensors'] : files.weights;
            const style = inspection.source === 'kura' ? files['style_vectors.npy'] : files.style;
            place(config, path.join(dir, 'config.json'));
            place(weights, path.join(dir, 'model.safetensors'));
            // スタイルベクトルは数値の配列として読み直して保存する (制限なしで読んだ場合も、保存し直したものは安全)
            try {
                await getWorker('tts').request('inspect_style_vectors', {
                    path: style,
                    allowUnsafe: options.allowUnsafe,
                    output: path.join(dir, 'style_vectors.npy'),
                });
            } finally {
                if (!inspection.safe) stopWorker('tts');
            }
            if (tts && multilingual && options.languages) tts = { ...tts, languages: options.languages };
        }
        return await finishVoice({
            id,
            feature,
            name,
            category: inspection.category,
            createdAt: Date.now(),
            rvc,
            tts,
        });
    } catch (error) {
        await discardVoiceDir(feature, id);
        throw error;
    } finally {
        cancelImport(token);
    }
}

// --- 作成中の声のモデル (学習・取り込みの確定) ---

// 新しい声のモデルを作り始める。モデルのファイルは返した dir (作成中の置き場) に書き、
// 完成したら registerTrainedVoice などで声のモデルとして登録する。途中で止めた場合は discardVoiceDir で消す
export function newVoiceDir(feature: VoiceModelFeature): { id: string; dir: string } {
    const id = crypto.randomUUID();
    const dir = voiceStagingDir(feature, id);
    fs.mkdirSync(dir, { recursive: true });
    return { id, dir };
}

// 学習で作ったモデルを登録する (ファイルは学習処理が newVoiceDir の置き場に書き込み済み)
export function registerTrainedVoice(
    feature: VoiceModelFeature,
    id: string,
    name: string,
    extra: { rvc?: RvcModelMeta; tts?: TtsModelMeta }
): Promise<VoiceModelInfo> {
    return finishVoice({ id, feature, name, category: 'trained', createdAt: Date.now(), ...extra });
}

// 作成中の置き場を消す
export async function discardVoiceDir(feature: VoiceModelFeature, id: string): Promise<void> {
    await removeTemp(voiceStagingDir(feature, id));
}

// 作成中の置き場に記録 (meta.json) を書き、名前を <ID> に変えて声のモデルにする
async function finishVoice(info: VoiceModelInfo): Promise<VoiceModelInfo> {
    const staging = voiceStagingDir(info.feature, info.id);
    writeJsonFile(path.join(staging, META_FILE), info);
    await renameWithRetry(staging, voiceDir(info.feature, info.id));
    return info;
}

// 変換に使う RVC モデルのファイルと設定。重み (model.safetensors) と、同じフォルダの設定 (model.json) を
// 補助プロセスがそのまま読む
export function rvcModelFiles(id: string): {
    weights: string;
    index: string | null;
    info: VoiceModelInfo;
    rvc: RvcModelMeta;
} {
    const voice = getVoice('converter', id);
    const rvc = voice.info.rvc;
    if (!rvc) throw new Error(`INVALID_RVC_MODEL: ${path.join(voice.dir, META_FILE)}`);
    const weights = path.join(voice.dir, 'model.safetensors');
    if (!fs.existsSync(weights)) throw new Error(`DATA_FILE_CORRUPT: ${weights}`);
    const index = path.join(voice.dir, 'model.index');
    return { weights, index: fs.existsSync(index) ? index : null, info: voice.info, rvc };
}
