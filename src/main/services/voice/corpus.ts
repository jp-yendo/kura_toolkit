import fs from 'fs';
import path from 'path';
import { bundledResourceDir } from './paths';
import { LANGUAGE_DEFINITIONS, type VoiceLanguage } from '../../../shared/voice/languages';
import type { TrainingSentence } from '../../../shared/voice/types';

// 読み上げの学習用の読み上げ文 (言語定義の文章のファイル。third_party/ に同梱する)

type CorpusFile = { sentences: { id: string; text: string }[] };

const corpusCache = new Map<VoiceLanguage, TrainingSentence[]>();

// 言語の読み上げ文 (ファイルの順)
export function corpusSentences(language: VoiceLanguage): TrainingSentence[] {
    let sentences = corpusCache.get(language);
    if (!sentences) {
        const file = path.join(
            bundledResourceDir('third_party'),
            ...LANGUAGE_DEFINITIONS[language].corpus.file.split('/')
        );
        const corpus = JSON.parse(fs.readFileSync(file, 'utf-8')) as CorpusFile;
        sentences = corpus.sentences.map(({ id, text }) => ({ id, text }));
        corpusCache.set(language, sentences);
    }
    return sentences;
}
