# vlog-generator（Cloud Run Jobs）
#
# ffmpeg-static は drawtext フィルタを含まない版があるため使わない。
# 氏名の焼き込み (F-309) に drawtext が必須なので、apt の ffmpeg を入れる。
# 日本語を描画するには CJK フォントも要る（無いと豆腐になる）。

FROM node:22-bookworm-slim AS build

WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@11.18.0 --activate

# ワークスペース定義を先に入れて依存解決のキャッシュを効かせる
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY jobs/vlog-generator/package.json jobs/vlog-generator/

RUN pnpm install --frozen-lockfile --filter @worklog/vlog-generator...

COPY packages/shared packages/shared
COPY jobs/vlog-generator jobs/vlog-generator

RUN pnpm --filter @worklog/shared build \
 && pnpm --filter @worklog/vlog-generator build \
 && pnpm install --frozen-lockfile --prod --filter @worklog/vlog-generator...

# ---------------------------------------------------------------------------

FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ffmpeg \
      fonts-noto-cjk \
 && rm -rf /var/lib/apt/lists/*

# drawtext と CJK フォントがあることをビルド時に確かめる。
# ここが欠けると、氏名が豆腐になった動画を大量に作ってから気づくことになる
RUN ffmpeg -hide_banner -filters | grep -q " drawtext " \
 && test -f /usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc

WORKDIR /repo

COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/packages/shared/package.json packages/shared/
COPY --from=build /repo/jobs/vlog-generator/dist jobs/vlog-generator/dist
COPY --from=build /repo/jobs/vlog-generator/node_modules jobs/vlog-generator/node_modules
COPY --from=build /repo/jobs/vlog-generator/package.json jobs/vlog-generator/

ENV NODE_ENV=production \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    VLOG_FONT_FILE=/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc

WORKDIR /repo/jobs/vlog-generator
CMD ["node", "dist/main.js"]
