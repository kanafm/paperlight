{
  description = "Paperlight macOS build";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs = { self, nixpkgs }:
    let
      system = "aarch64-darwin";
      pkgs = import nixpkgs { inherit system; };
      tools = pkgs.callPackage ./nix/tools.nix { };
    in {
      packages.${system} = {
        icon = pkgs.callPackage ./nix/icon.nix { };
        languages = pkgs.callPackage ./nix/languages.nix { inherit tools; };
        pdf = pkgs.callPackage ./nix/pdf.nix { inherit tools; };
        dependencies = pkgs.fetchPnpmDeps {
          pname = "paperlight";
          src = self;
          pnpm = tools.pnpm;
          fetcherVersion = 5;
          hash = "sha256-Mb+TjC3CS3W7pP03Wzy/D/hoxKX4utDmCp10JJDGOEg=";
          postInstall = ''
            for root in build remote remote/web extensions/copilot build/npm/gyp; do
              pnpm --dir "$root" install --ignore-scripts --frozen-lockfile --force
            done
          '';
        };
        default = pkgs.callPackage ./nix/package.nix {
          inherit tools;
          src = self;
          pnpmDeps = self.packages.${system}.dependencies;
          languages = self.packages.${system}.languages;
          icon = self.packages.${system}.icon;
          pdf = self.packages.${system}.pdf;
          revision = builtins.substring 0 40 (self.rev or self.dirtyRev or "e4c97df79de850b9a719303384c95b39ab61afaa");
        };
      };
      devShells.${system}.default = pkgs.mkShell {
        packages = with pkgs; [ tools.node tools.pnpm python3 git pkg-config ];
      };
    };
}
