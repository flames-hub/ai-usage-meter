# AI Usage Meter — Codex first edition

PCブラウザ / スマホ対応の静的ダッシュボードです。現段階ではCodexのChatGPT利用枠だけを表示します。

## 最短セットアップ（Windows）

ZIPを展開したフォルダでPowerShellを開き、次だけ実行します。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\PUBLISH.ps1
```

このスクリプトが自動で行うこと:

1. ログイン済みCodex CLIのApp Serverから `account/rateLimits/read` を取得
2. `~/Projects/ai-usage-meter` に `flames-hub/ai-usage-meter` をclone / pull
3. Web/PWA一式と公開用 `data/usage.json` を配置
4. commit / push

GitHub CLI (`gh`) がある場合、Pagesの有効化も試すには:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\PUBLISH.ps1 -TryEnablePages
```

Pagesを手動で有効化する場合は、GitHubの `Settings -> Pages` で `main` / `(root)` を選択します。

公開URL:

`https://flames-hub.github.io/ai-usage-meter/`

## 残量の更新

初回セットアップ後は:

```powershell
cd "$HOME\Projects\ai-usage-meter"
.\tools\update-codex-usage.ps1 -Push
```

30分ごとの自動更新を入れる場合:

```powershell
.\tools\install-auto-update.ps1 -Minutes 30
```

## 表示内容

- 5時間枠（Codex側が返す場合）
- 週間枠
- 残量 / 使用率
- リセット時刻
- ChatGPTプラン
- 最終取得時刻
- PC / スマホのレスポンシブ表示
- PWA

## セキュリティ

GitHubへ送るのは `data/usage.json` の利用率・リセット時刻などだけです。OAuthトークン、APIキー、ChatGPTアカウントIDは保存・pushしません。

## App Server接続について

Windowsのnpm系CLIではPowerShell shim (`codex.ps1`) 経由で標準入力をリダイレクトすると、App ServerへJSONLが届かないケースがあります。本版は `cmd.exe` 経由で `codex app-server --stdio` を起動し、stdin/stdoutを直接接続します。失敗時はApp Serverのstderrも表示します。
