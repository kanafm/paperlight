{ stdenvNoCC, resvg }:
stdenvNoCC.mkDerivation {
  pname = "paperlight-icon";
  version = "1";
  src = ../paperlight/icon.svg;
  dontUnpack = true;
  nativeBuildInputs = [ resvg ];
  buildPhase = ''
    runHook preBuild
    mkdir Paperlight.iconset
    for size in 16 32 128 256 512; do
      resvg --width "$size" "$src" "Paperlight.iconset/icon_''${size}x''${size}.png"
      resvg --width "$((size * 2))" "$src" "Paperlight.iconset/icon_''${size}x''${size}@2x.png"
    done
    /usr/bin/iconutil --convert icns Paperlight.iconset
    runHook postBuild
  '';
  installPhase = ''
    runHook preInstall
    mkdir -p "$out"
    cp Paperlight.icns "$out/"
    runHook postInstall
  '';
}
