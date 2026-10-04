// Python の補助プロセス・学習処理の出力を、診断用のログとして DevTools へ流す (console-bridge 経由)。
// 利用者に見せる情報ではなく、不具合の調査に使う詳細なため、警告やエラーとしては扱わない。
export function pythonLog(source: string, line: string): void {
    // eslint-disable-next-line no-console -- 診断用の詳細ログ。warn / error にすると正常時の出力まで警告として表示されるため
    console.log(`[${source}] ${line}`);
}
