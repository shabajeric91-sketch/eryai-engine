// ERYAI_AUTO_GENERATED - DO NOT EDIT
// This file is managed by eryai-core-schema broadcast
// To customize, remove the line above and your changes will be preserved

export default function handler(req, res) {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    repo: process.env.VERCEL_GIT_REPO_SLUG || 'unknown',
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.substring(0, 7) || 'unknown',
    version: process.env.npm_package_version || '1.0.0'
  });
}
