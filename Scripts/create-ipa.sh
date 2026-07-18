#!/bin/sh
set -eu

archive_path=${1:?Usage: create-ipa.sh /path/to/Hammy.app /path/to/Hammy.ipa}
ipa_path=${2:?Usage: create-ipa.sh /path/to/Hammy.app /path/to/Hammy.ipa}

if [ ! -d "$archive_path" ]; then
  echo "App bundle was not found: $archive_path" >&2
  exit 1
fi

executable=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$archive_path/Info.plist")
binary_path="$archive_path/$executable"

if [ ! -f "$binary_path" ]; then
  echo "App executable was not found: $binary_path" >&2
  exit 1
fi

# An IPA is only installable on an iPhone or iPad when the contained Mach-O is
# built for iOS. Simulator bundles use a different platform slice even when
# their CPU architecture is arm64, which produces a misleading dlopen error.
if xcrun vtool -show-build "$binary_path" | grep -q 'platform IOSSIMULATOR'; then
  echo "Refusing to package a simulator app. Archive with -destination 'generic/platform=iOS' first." >&2
  exit 1
fi

staging_dir=$(mktemp -d)
trap 'rm -rf "$staging_dir"' EXIT
mkdir -p "$staging_dir/Payload"
cp -R "$archive_path" "$staging_dir/Payload/Hammy.app"
mkdir -p "$(dirname "$ipa_path")"
(cd "$staging_dir" && /usr/bin/zip -qry "$ipa_path" Payload)
