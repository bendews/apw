# Contributing

## Testing browser changes on macOS

Install the iCloud Passwords extension in the supported browser, then run the
checks and compile APW locally:

```sh
deno fmt --check
deno check src/cli.ts
deno task compile
./apw start --browser dia
```

Replace `dia` with the browser ID being tested. Confirm the browser launches,
the extension loads, and APW reports that the extension connected. Stop the
test process with Ctrl-C when finished. PIN authentication and password or OTP
retrieval should be tested separately when possible.

## Optional: test a Homebrew build from a fork

For testing a branch through Homebrew, create a local tap and save a formula
there. The example below builds the `dia-support` branch from a fork; replace
`your-github-username` with your lowercase GitHub username:

```sh
brew tap-new your-github-username/local --no-git
TAP_DIR="$(brew --repository)/Library/Taps/your-github-username/homebrew-local"
mkdir -p "$TAP_DIR/Formula"
cat > "$TAP_DIR/Formula/apw.rb" <<'RUBY'
class Apw < Formula
  desc "CLI for Apple Passwords (also known as iCloud Keychain)"
  homepage "https://github.com/bendews/apw"
  url "https://github.com/bendews/apw.git",
      tag:      "v1.1.1",
      revision: "7b2f157ef1a46e15320fe97b1a75073d791a6eec"
  license "GPL-3.0-or-later"
  head "https://github.com/your-github-username/apw.git", branch: "dia-support"

  depends_on "deno" => :build
  depends_on :macos

  def install
    system "deno", "compile", "--allow-all", "-o", "apw", "src/cli.ts"
    bin.install "apw"
  end
end
RUBY
brew install --HEAD --build-from-source your-github-username/local/apw
```

This formula is a local testing aid only; it is not part of APW's source or
release configuration. The project does not install browsers. It detects
supported browser apps already installed in `/Applications`, including apps
installed outside Homebrew.
