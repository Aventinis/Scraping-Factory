// Which kind of build this is — decided when the extension is packaged, never
// by the user. The repository (and so "Load unpacked" from a checkout) is the
// development channel; install/build-bundle.sh rewrites CHANNEL to 'release'
// in the extension it ships. Development conveniences that would be a
// security risk in the hands of an ordinary user (talking plain HTTP to a
// companion on another machine, see shared/companion-config.js) exist only in
// the development channel; nothing in the extension's UI or storage can turn
// them on in a release build.
const CHANNEL = 'development';

function isDevelopmentBuild() {
  return CHANNEL === 'development';
}

module.exports = { CHANNEL, isDevelopmentBuild };

