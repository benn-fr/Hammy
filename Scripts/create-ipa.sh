#!/bin/sh
set -eu

archive_path=${1:?Usage: create-ipa.sh /path/to/Hammy.app /path/to/Hammy.ipa}
ipa_path=${2:?Usage: create-ipa.sh /path/to/Hammy.app /path/to/Hammy.ipa}

if [ ! -d "$archive_path" ]; then
  echo "App bundle was not found: $archive_path" >&2
  exit 1
fi

staging_dir=$(mktemp -d)
trap 'rm -rf "$staging_dir"' EXIT
mkdir -p "$staging_dir/Payload"
cp -R "$archive_path" "$staging_dir/Payload/Hammy.app"
mkdir -p "$(dirname "$ipa_path")"
(cd "$staging_dir" && /usr/bin/zip -qry "$ipa_path" Payload)
