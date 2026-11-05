{ lib, stdenv, cctools, fetchurl, krb5, nodejs, python3, git, pkg-config, jq, unzip, sqlite, zstd, cacert, tools, src, pnpmDeps, languages, pdf, revision }:
let
  electron = fetchurl {
    url = "https://github.com/electron/electron/releases/download/v43.8.3/electron-v43.8.3-darwin-arm64.zip";
    sha256 = "08e693ae36cfd230105aabe70c626b1a243c13534a529c35a80c1b87cb8da7b4";
  };
  electronHeaders = fetchurl {
    url = "https://electronjs.org/headers/v43.8.3/node-v43.8.3-headers.tar.gz";
    sha256 = "d23630d0b98161bec7860dcc482187aca380b1e0da264c1ed5efb42bce79d604";
  };
  nodeHeaders = fetchurl {
    url = "https://nodejs.org/dist/v24.22.1/node-v24.22.1-headers.tar.gz";
    sha256 = "322e0a27db9088093ab8347bdc8c7e0aaa21dc9ed548390bf06b394494c09267";
  };
  electronTypes = fetchurl {
    url = "https://github.com/electron/electron/releases/download/v43.8.3/electron.d.ts";
    sha256 = "782f47bd6013fa7d0c9640f2ce38b54759ba999ca3f5070711e5cd46e726869d";
  };
  ripgrep = fetchurl {
    url = "https://github.com/microsoft/ripgrep-prebuilt/releases/download/v15.0.1/ripgrep-v15.0.1-aarch64-apple-darwin.tar.gz";
    hash = "sha256-L6FkZP2GOFiKZ8f8Fy08S1f73GXf82bhCwsOkHNGKKY=";
  };
  defaults = {
    "editor.scrollbar.horizontal" = "hidden";
    "editor.scrollbar.horizontalScrollbarSize" = 0;
    "workbench.colorTheme" = "Paperlight Light";
    "workbench.preferredLightColorTheme" = "Paperlight Light";
    "workbench.startupEditor" = "welcomePage";
    "window.restoreWindows" = "none";
    "workbench.editor.restoreEditors" = false;
    "terminal.integrated.enablePersistentSessions" = false;
    "files.hotExit" = "off";
    "update.showReleaseNotes" = false;
    "chat.disableAIFeatures" = true;
    "chat.copilotCliCommand.enabled" = false;
    "workbench.activityBar.location" = "hidden";
    "terminal.integrated.tabs.enabled" = false;
    "workbench.editorAssociations" = {
      "*.{md,mkd,mkdn,mdwn,mdown,markdown,markdn,mdtxt,mdtext,litcoffee,ron,ronn,workbook}" = "vscode.markdown.editor";
    };
    "markdown.copyFiles.destination" = { "**/*" = "img/"; };
    "markdown.copyFiles.overwriteBehavior" = "nameIncrementally";
  };
  product = builtins.fromJSON (builtins.readFile ../product.json);
  extensions = map (extension: extension // {
    vsix = toString (fetchurl {
      url = "${extension.repo}/releases/download/v${extension.version}/${extension.name}.${extension.version}.vsix";
      sha256 = extension.sha256;
    });
  }) product.builtInExtensions;
in
stdenv.mkDerivation {
  pname = "paperlight";
  version = (builtins.fromJSON (builtins.readFile ../package.json)).version;
  inherit src;
  patches = [ ./product-defaults.patch ./markdown-editor.patch ./navigation-defaults.patch ];
  nativeBuildInputs = [ tools.node tools.pnpm cctools python3 git pkg-config jq unzip sqlite zstd cacert ];
  buildInputs = [ krb5 ];
  dontFixup = true;
  env = {
    BUILD_SOURCEVERSION = revision;
    SOURCE_DATE_EPOCH = toString (src.lastModified or 1);
    VSCODE_ARCH = "arm64";
    VSCODE_QUALITY = "stable";
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
    ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
    FOUNDRY_LOCAL_SKIP_INSTALL = "1";
    PAPERLIGHT_DISABLE_AI = "1";
    npm_config_update_notifier = "false";
    npm_config_node_gyp = "${nodejs}/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js";
    pnpm_config_reporter = "append-only";
    pnpm_config_pm_on_fail = "ignore";
    pnpm_config_offline = "true";
    pnpm_config_frozen_lockfile = "true";
    pnpm_config_trust_lockfile = "true";
  };
  configurePhase = ''
    runHook preConfigure
    export HOME="$TMPDIR/home"
    export XDG_CACHE_HOME="$HOME/.cache"
    export npm_config_devdir="$TMPDIR/node-gyp"
    export PAPERLIGHT_ELECTRON_ARCHIVE="$TMPDIR/electron-v43.8.3-darwin-arm64.zip"
    cp ${electron} "$PAPERLIGHT_ELECTRON_ARCHIVE"
    mkdir -p "$HOME" "$TMPDIR/pnpm-store" "$npm_config_devdir/43.8.3" "$npm_config_devdir/24.22.1"
    tar --zstd -xf ${pnpmDeps}/pnpm-store.tar.zst -C "$TMPDIR/pnpm-store"
    chmod -R u+w "$TMPDIR/pnpm-store"
    if test -f "$TMPDIR/pnpm-store/v11/index.db.sql"; then
      sqlite3 "$TMPDIR/pnpm-store/v11/index.db" < "$TMPDIR/pnpm-store/v11/index.db.sql"
    fi
    export pnpm_config_store_dir="$TMPDIR/pnpm-store"
    tar -xzf ${electronHeaders} --strip-components=1 -C "$npm_config_devdir/43.8.3"
    tar -xzf ${nodeHeaders} --strip-components=1 -C "$npm_config_devdir/24.22.1"
    chmod -R u+w "$npm_config_devdir"
    cp build/npm/gyp/custom-headers/* "$npm_config_devdir/43.8.3/include/node/"
    printf '11\n' > "$npm_config_devdir/43.8.3/installVersion"
    printf '11\n' > "$npm_config_devdir/24.22.1/installVersion"
    substituteInPlace build/npm/nodeGypHeaders.ts \
      --replace-fail "['install', '--dist-url'" "['install', '--ensure', '--dist-url'"
    mkdir -p "$TMPDIR/bin"
    ln -s ${nodejs}/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js "$TMPDIR/bin/node-gyp"
    ln -s ${stdenv.cc}/bin/clang "$TMPDIR/bin/gcc"
    ln -s ${stdenv.cc}/bin/clang++ "$TMPDIR/bin/g++"
    export PATH="$TMPDIR/bin:$PATH"
    mkdir -p .build/typings "$TMPDIR/vscode-ripgrep-cache-1.17.1"
    cp ${electronTypes} .build/typings/electron.d.ts
    cp ${ripgrep} "$TMPDIR/vscode-ripgrep-cache-1.17.1/ripgrep-v15.0.1-aarch64-apple-darwin.tar.gz"
    substituteInPlace build/lib/date.ts \
      --replace-fail 'return new Date().toISOString();' 'return new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString();'
    substituteInPlace build/gulpfile.vscode.ts \
      --replace-fail $'\t\t\tcompileCopilotExtensionBuildTask,' $'\t\t\t...(process.env.PAPERLIGHT_DISABLE_AI ? [] : [compileCopilotExtensionBuildTask]),' \
      --replace-fail 'prepareCopilotRipgrepShimTask(platform, arch, destinationFolderName)' '...(process.env.PAPERLIGHT_DISABLE_AI ? [] : [prepareCopilotRipgrepShimTask(platform, arch, destinationFolderName)])'
    git init -q
    pnpm install --offline --frozen-lockfile
    substituteInPlace node_modules/@vscode/gulp-electron/src/download.js \
      --replace-fail 'downloadArtifact(downloadOpts)' 'Promise.resolve(process.env.PAPERLIGHT_ELECTRON_ARCHIVE)'
    jq --argjson extensions '${builtins.toJSON extensions}' --argjson defaults '${builtins.toJSON defaults}' \
      '.configurationDefaults = $defaults | .useInMemorySecretStorage = true | .builtInExtensions = $extensions | .nameShort = "Paperlight" | .nameLong = "Paperlight" | .applicationName = "paperlight" | .dataFolderName = ".paperlight" | .sharedDataFolderName = ".paperlight-shared" | .darwinBundleIdentifier = "org.paperlight.editor" | .urlProtocol = "paperlight"' \
      product.json > product.json.tmp
    mv product.json.tmp product.json
    substituteInPlace build/lib/builtInExtensions.ts \
      --replace-fail 'path.join(root, extension.vsix)' 'path.resolve(root, extension.vsix)'
    pnpm run download-builtin-extensions
    jq '.builtInExtensions |= map(del(.vsix))' product.json > product.json.tmp
    mv product.json.tmp product.json
    runHook postConfigure
  '';
  buildPhase = ''
    runHook preBuild
    pnpm run gulp vscode-darwin-arm64-min
    runHook postBuild
  '';
  installPhase = ''
    runHook preInstall
    mkdir -p "$out/Applications"
    cp -R ../VSCode-darwin-arm64/Paperlight.app "$out/Applications/"
    cp -R ${languages} "$out/Applications/Paperlight.app/Contents/Resources/app/extensions/paperlight-languages"
    cp -R ${pdf} "$out/Applications/Paperlight.app/Contents/Resources/app/extensions/paperlight-pdf"
    /usr/bin/codesign --force --deep --sign - "$out/Applications/Paperlight.app"
    /usr/bin/codesign --verify --deep --strict "$out/Applications/Paperlight.app"
    runHook postInstall
  '';
  meta = {
    platforms = [ "aarch64-darwin" ];
    license = lib.licenses.mit;
  };
}
