// electron-builder afterAllArtifactBuild hook implementation.
//
// Purpose: compress the Windows portable .exe artifact into a same-named .zip
// and remove the original .exe. Distributing an unsigned bare .exe triggers
// stricter browser / antivirus warnings, while a .zip is treated more leniently.
//
// Detection rule: an artifact path ending in .exe is treated as the portable
// build only when no sibling .blockmap exists. NSIS always emits the pair
// "<name>.exe" + "<name>.exe.blockmap"; the absence of the blockmap therefore
// uniquely identifies the portable target output.
//
// macOS / Linux builds: the hook short-circuits unless the build result
// contains a Windows portable target, so it is a no-op for non-Windows runs.
//
// Non-portable Windows artifacts (NSIS .exe, .blockmap, latest.yml, etc.)
// are never touched.

'use strict';

const { promises: fs, createWriteStream } = require('fs');
const path = require('path');
const archiver = require('archiver');

function hasWindowsPortableTarget(buildResult) {
    const platformToTargets = buildResult && buildResult.platformToTargets;
    if (!platformToTargets || typeof platformToTargets.entries !== 'function') return false;

    for (const [platform, archMap] of platformToTargets.entries()) {
        const platformName = (platform && (platform.name || platform.nodeName)) || '';
        // electron-builder's Platform.WINDOWS exposes name === 'windows' (and nodeName === 'win32').
        if (platformName !== 'windows' && platformName !== 'win32') continue;
        if (!archMap || typeof archMap.values !== 'function') continue;
        for (const target of archMap.values()) {
            if (target && target.name === 'portable') return true;
        }
    }
    return false;
}

async function pathExists(p) {
    try {
        await fs.access(p);
        return true;
    } catch {
        return false;
    }
}

function zipFile(sourceExe, destZip) {
    return new Promise((resolve, reject) => {
        const output = createWriteStream(destZip);
        const archive = archiver('zip', { zlib: { level: 9 } });
        output.on('close', () => resolve());
        output.on('error', reject);
        archive.on('error', reject);
        archive.pipe(output);
        archive.file(sourceExe, { name: path.basename(sourceExe) });
        archive.finalize();
    });
}

async function run(buildResult) {
    if (!hasWindowsPortableTarget(buildResult)) {
        return [];
    }

    const artifactPaths = Array.isArray(buildResult.artifactPaths) ? buildResult.artifactPaths : [];
    const exePaths = artifactPaths.filter((p) => p.toLowerCase().endsWith('.exe'));

    const generatedZips = [];

    for (const exePath of exePaths) {
        const blockmapPath = exePath + '.blockmap';
        if (await pathExists(blockmapPath)) {
            // NSIS-produced exe (paired with .blockmap). Leave it alone.
            continue;
        }

        const zipPath = exePath.replace(/\.exe$/i, '.zip');
        console.log('[zip-portable] compressing ' + path.basename(exePath) + ' -> ' + path.basename(zipPath));
        await zipFile(exePath, zipPath);
        await fs.unlink(exePath);
        generatedZips.push(zipPath);
    }

    return generatedZips;
}

module.exports = run;
module.exports.default = run;
