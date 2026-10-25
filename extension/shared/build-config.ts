// Which kind of build this is — decided when the extension is built, never by
// the user. A plain `npm run build` (and so "Load unpacked" from a checkout) is
// the development channel; install/build-bundle.sh builds the shipped extension
// with `node build.js --channel release`, which replaces process.env.SF_CHANNEL
// with a constant. Development conveniences that would be a security risk in
// the hands of an ordinary user (talking plain HTTP to a companion on another
// machine, see shared/companion-config.ts) exist only in the development
// channel; nothing in the extension's UI or storage can turn them on in a
// release build. (Under Jest the variable is unset, which means development.)
export type Channel = 'release' | 'development';

export const CHANNEL: Channel = process.env.SF_CHANNEL === 'release' ? 'release' : 'development';

export function isDevelopmentBuild(): boolean {
  return CHANNEL === 'development';
}
