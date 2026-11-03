{ lib, stdenvNoCC, fetchPnpmDeps, sqlite, zstd, tools }:
let
  src = lib.fileset.toSource {
    root = ../paperlight/languages;
    fileset = lib.fileset.unions [
      ../paperlight/languages/package.json
      ../paperlight/languages/pnpm-lock.yaml
      ../paperlight/languages/pnpm-workspace.yaml
      ../paperlight/languages/tsconfig.json
      ../paperlight/languages/src
      ../paperlight/languages/test
    ];
  };
  pnpmDeps = fetchPnpmDeps {
    pname = "paperlight-languages";
    inherit src;
    pnpm = tools.pnpm;
    fetcherVersion = 5;
    hash = "sha256-jbWmeofO2m0E2bHbJFgJMCuaKfUhE+XPIVBGygOp/Rc=";
  };
in
stdenvNoCC.mkDerivation {
  pname = "paperlight-languages";
  version = "0.1.0";
  inherit src;
  nativeBuildInputs = [ tools.node tools.pnpm sqlite zstd ];
  dontFixup = true;
  configurePhase = ''
    runHook preConfigure
    export HOME="$TMPDIR/home"
    export pnpm_config_store_dir="$TMPDIR/pnpm-store"
    export pnpm_config_pm_on_fail=ignore
    export pnpm_config_offline=true
    export pnpm_config_trust_lockfile=true
    mkdir -p "$HOME" "$pnpm_config_store_dir"
    tar --zstd -xf ${pnpmDeps}/pnpm-store.tar.zst -C "$pnpm_config_store_dir"
    chmod -R u+w "$pnpm_config_store_dir"
    if test -f "$pnpm_config_store_dir/v11/index.db.sql"; then
      sqlite3 "$pnpm_config_store_dir/v11/index.db" < "$pnpm_config_store_dir/v11/index.db.sql"
    fi
    pnpm install --offline --frozen-lockfile
    runHook postConfigure
  '';
  buildPhase = ''
    runHook preBuild
    pnpm typecheck
    pnpm test
    pnpm build
    runHook postBuild
  '';
  installPhase = ''
    runHook preInstall
    mkdir -p "$out/dist"
    cp package.json "$out/"
    cp dist/extension.cjs "$out/dist/"
    cp ${../LICENSE.txt} "$out/LICENSE.txt"
    runHook postInstall
  '';
  meta = {
    platforms = [ "aarch64-darwin" ];
    license = lib.licenses.mit;
  };
}
