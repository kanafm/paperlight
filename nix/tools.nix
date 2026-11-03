{ stdenvNoCC, fetchurl, nodejs-slim }:
rec {
  node = stdenvNoCC.mkDerivation {
    pname = "paperlight-node";
    version = "24.22.1";
    src = fetchurl {
      url = "https://nodejs.org/dist/v24.22.1/node-v24.22.1-darwin-arm64.tar.gz";
      sha256 = "89c682593d76cd44233fa53b1563264e7de9cbb189cad169135c5b4fadfbc0a7";
    };
    installPhase = ''
      mkdir -p "$out"
      cp -R bin include lib share "$out/"
    '';
    dontFixup = true;
  };

  pnpm = stdenvNoCC.mkDerivation {
    pname = "paperlight-pnpm";
    passthru = { inherit nodejs-slim; };
    version = "12.16.0";
    src = fetchurl {
      url = "https://registry.npmjs.org/@pnpm/exe.darwin-arm64/-/exe.darwin-arm64-12.16.0.tgz";
      hash = "sha512-0kMENoYlVTxiCPWf7fXEF3EtYXUySilIC+UAe5Z7kC8keY8+ul8ddhuHjSU0e85qlKDIJfIxDYACse/Lx8It/Q==";
    };
    installPhase = ''
      mkdir -p "$out/bin"
      install -m755 pnpm "$out/bin/pnpm"
    '';
    dontFixup = true;
  };
}
