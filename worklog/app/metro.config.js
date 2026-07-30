const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

// pnpm workspace（monorepo）構成。packages/shared を Metro に見せる必要がある。
// .npmrc の node-linker=hoisted と合わせて成立しているので、片方だけ変えないこと。
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
