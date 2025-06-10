/* eslint-disable no-undef */

var plugin;

function log(msg) {
  Zotero.debug('[__addonName__] ' + msg);
}

function install() {
  log('Installed plugin');
}

async function startup({ id, version, rootURI }) {
  log('Starting plugin');

  Services.scriptloader.loadSubScript(
    `${rootURI}/content/scripts/__addonRef__.js`,
  );
  plugin = new __addonInstance__.Plugin({ id, version, rootURI });
  plugin.startup();
}

function shutdown() {
  log('Shutting down plugin');
  plugin?.shutdown();
  plugin = undefined;
}

function uninstall() {
  log('Uninstalled plugin');
}
