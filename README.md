<div align="center">
  <a href="https://github.com/bendews/apw">
    <img src="icon.png" alt="Logo" width="80" height="80">
  </a>

<h3 align="center">Apple Passwords CLI</h3>

<p align="center">
    A CLI for access to Apple Passwords. A foundation for enabling integration and automation.
    <br />
    <a href="https://github.com/bendews/apw"><strong>Explore the docs »</strong></a>
    <br />
    <br />
    <a href="https://github.com/bendews/apw">View Demo</a>
    ·
    <a href="https://github.com/bendews/apw/issues">Report Bug</a>
    ·
    <a href="https://github.com/bendews/apw/issues">Request Feature</a>
  </p>

[![Contributors][contributors-shield]][contributors-url]
[![Forks][forks-shield]][forks-url] [![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![MIT License][license-shield]][license-url]
<br />

</div>

<!-- ABOUT THE PROJECT -->

## About The Project

This project introduces a CLI interface designed to access iCloud passwords and
OTP tokens. The core objective is to provide a secure and straightforward way to
retrieve iCloud passwords, facilitating integration with other systems or for
personal convenience.

It utilises a built in helper tool in macOS 14 and above to facilitate this
functionality.

## Getting Started

Ensure homebrew is installed or build from source.

### Installation

Installation is via Homebrew:

```
brew install apw
```

## Integrations

The following integrations have been completed:

- Raycast (extension link) to provide quick access to passwords and OTP tokens.
  Will automatically retrieve the keychain entry for the currently active
  webpage.

The following are some future integration ideas:

- SSH Agent to allow storing and using SSH keys/passwords via iCloud
- Menubar application to provide a standalone interface

## Usage

Enable the daemon to run on startup:

`brew service enable apw`

Authenticate the daemon interactively:

_This is required every time the daemon starts i.e on boot_

`apw auth`

Query for available passwords:

`apw pw list google.com`

View more commands & help:

`apw --help`

```shell
Options:

  -h, --help     - Show this help.                            
  -V, --version  - Show the version number for this program.  

Commands:

  auth   - Authenticate CLI with daemon.         
  pw     - Interactively list accounts/passwords.
  otp    - Interactively list accounts/OTPs.     
  start  - Start the daemon.
```

<!-- CONTRIBUTING -->

## Contributing

Contributions are what make the open source community such an amazing place to
learn, inspire, and create. Any contributions you make are **greatly
appreciated**.

If you have a suggestion that would make this better, please fork the repo and
create a pull request. You can also simply open an issue with the tag
"enhancement". Don't forget to give the project a star! Thanks again!

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

Distributed under the GPL V3.0 License. See `LICENSE` for more information.

## Contact

Ben Dews - [#](https://bendews.com)

Project Link: [https://github.com/bendews/apw](https://github.com/bendews/apw)

<!-- ACKNOWLEDGMENTS -->

## Acknowledgments

- [au2001 - iCloud Passwords for Firefox](https://github.com/au2001/icloud-passwords-firefox) -
  their SRP implementation was _so_ much better than mine.

<!-- MARKDOWN LINKS & IMAGES -->
<!-- https://www.markdownguide.org/basic-syntax/#reference-style-links -->

[contributors-shield]: https://img.shields.io/github/contributors/bendews/apw.svg?style=for-the-badge
[contributors-url]: https://github.com/bendews/apw/graphs/contributors
[forks-shield]: https://img.shields.io/github/forks/bendews/apw.svg?style=for-the-badge
[forks-url]: https://github.com/bendews/apw/network/members
[stars-shield]: https://img.shields.io/github/stars/bendews/apw.svg?style=for-the-badge
[stars-url]: https://github.com/bendews/apw/stargazers
[issues-shield]: https://img.shields.io/github/issues/bendews/apw.svg?style=for-the-badge
[issues-url]: https://github.com/bendews/apw/issues
[license-shield]: https://img.shields.io/github/license/bendews/apw.svg?style=for-the-badge
[license-url]: https://github.com/bendews/apw/blob/master/LICENSE.txt
[product-screenshot]: images/screenshot.png
