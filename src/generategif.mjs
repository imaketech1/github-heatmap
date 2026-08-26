import puppeteer from 'puppeteer-core';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const execPromise = promisify(exec);
const __dirname = dirname(fileURLToPath(import.meta.url));

function findChromium() {
    const paths = [
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/snap/bin/chromium',
        '/usr/local/bin/chromium',
        '/opt/google/chrome/chrome',
        process.env.CHROME_PATH,
        process.env.CHROMIUM_PATH,
    ].filter(Boolean);

    for (const path of paths) {
        if (path && existsSync(path)) {
            return path;
        }
    }
    return null;
}

async function recordSvgAnimation(svgPath, outputPath, loops = 1, fps = 10) {
    console.log('🎬 Recording SVG animation...');
    console.log(`🔄 Recording ${loops} complete loop(s) (past → future → past)`);
    console.log(`🎞️ ${fps} FPS`);

    // Check if ffmpeg is available
    try {
        await execPromise('ffmpeg -version');
    } catch {
        console.error('❌ FFmpeg not found.');
        console.log('  Install: sudo apt-get install ffmpeg');
        process.exit(1);
    }

    // Find Chromium
    const chromiumPath = findChromium();
    if (!chromiumPath) {
        console.error('Chromium not found.');
        console.log('Install: sudo apt-get install chromium-browser');
        process.exit(1);
    }

    console.log(`Using Chromium: ${chromiumPath}`);

    const browser = await puppeteer.launch({
        headless: 'new',
        executablePath: chromiumPath,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-web-security',
            '--allow-file-access-from-files',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ]
    });

    const page = await browser.newPage();

    let svgContent = await readFile(svgPath, 'utf8');
    const svgDir = dirname(resolve(svgPath));

    const durationMatch = svgContent.match(/<animateMotion[^>]*dur="([^"]*?)s"/);
    let loopDuration = 15;
    if (durationMatch) {
        loopDuration = parseFloat(durationMatch[1]);
        console.log(`Found animation duration: ${loopDuration}s per loop`);
    } else {
        console.log(`Using default duration: ${loopDuration}s per loop`);
    }
    const slowFactor = 2;
    const slowedDuration = loopDuration * slowFactor;
    console.log(`Slowing down: ${loopDuration}s → ${slowedDuration}s`);
    svgContent = svgContent.replace(
        /<animateMotion[^>]*dur="([^"]*?)s"/,
        `<animateMotion dur="${slowedDuration}s"`
    );

    const imageMatches = svgContent.match(/<image[^>]*href="([^"]*\.gif)"[^>]*>/g) || [];
    console.log(`Loading ${imageMatches.length} GIF assets...`);

    for (const match of imageMatches) {
        const hrefMatch = match.match(/href="([^"]*\.gif)"/);
        if (!hrefMatch) continue;

        const gifPath = hrefMatch[1];
        const absoluteGifPath = resolve(svgDir, gifPath);

        try {
            console.log(`Loading ${gifPath}...`);
            const gifBuffer = await readFile(absoluteGifPath);
            const base64 = gifBuffer.toString('base64');
            const dataUri = `data:image/gif;base64,${base64}`;
            svgContent = svgContent.replace(
                `href="${gifPath}"`,
                `href="${dataUri}"`
            );
            console.log(`  Loaded ${gifPath} (${(gifBuffer.length / 1024).toFixed(1)} KB)`);
        } catch (error) {
            console.log(`   Could not load ${gifPath}: ${error.message}`);
        }
    }

    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                * { margin: 0; padding: 0; }
                body { 
                    background: #0d1117; 
                    display: flex; 
                    justify-content: center; 
                    align-items: center; 
                    min-height: 100vh;
                    overflow: hidden;
                }
                svg {
                    max-width: 100%;
                    height: auto;
                }
            </style>
        </head>
        <body>
            ${svgContent}
            <script>
                console.log('Animation loaded');
                const anim = document.querySelector('animateMotion');
                if (anim) {
                    anim.beginElement();
                    console.log('Animation started');
                }
            </script>
        </body>
        </html>
    `;

    await page.setContent(htmlContent, {
        waitUntil: 'networkidle0',
        timeout: 30000
    });

    await page.waitForFunction(() => {
        const images = document.querySelectorAll('image');
        let loaded = 0;
        images.forEach(img => {
            if (img.complete && img.naturalWidth > 0) loaded++;
        });
        return loaded === images.length;
    }, { timeout: 10000 }).catch(() => {
        console.log('Some images may not have loaded completely');
    });

    const dims = await page.evaluate(() => {
        const svg = document.querySelector('svg');
        return {
            width: parseInt(svg.getAttribute('width')) || 800,
            height: parseInt(svg.getAttribute('height')) || 600
        };
    });

    console.log(`Recording ${dims.width}x${dims.height} at ${fps} FPS`);

    await page.setViewport({
        width: dims.width,
        height: dims.height
    });

    await new Promise(r => setTimeout(r, 2000));

    // Create temp directory
    const tempDir = './temp_frames';
    await mkdir(tempDir, { recursive: true });

    const totalDuration = slowedDuration * loops;
    const totalFrames = Math.ceil(totalDuration * fps);

    console.log(`📹 Recording ${totalFrames} frames (${totalDuration.toFixed(1)}s)`);

    for (let frame = 0; frame < totalFrames; frame++) {
        const screenshot = await page.screenshot({
            type: 'png',
            omitBackground: false
        });

        await writeFile(
            `${tempDir}/frame_${String(frame).padStart(4, '0')}.png`,
            screenshot
        );

        if (frame % 30 === 0 || frame === totalFrames - 1) {
            const progress = ((frame + 1) / totalFrames * 100).toFixed(1);
            process.stdout.write(`\r  Frame ${frame + 1}/${totalFrames} (${progress}%)`);
        }
    }

    console.log('\n✨ Encoding GIF...');

    await mkdir('output', { recursive: true });

    const ffmpegCommand = `
        ffmpeg -framerate ${fps} -i ${tempDir}/frame_%04d.png \
        -vf "fps=${fps},scale=${dims.width}:${dims.height}:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5" \
        -loop 0 ${outputPath} -y
    `;

    try {
        await execPromise(ffmpegCommand);
        console.log(`GIF saved: ${outputPath}`);

        const stats = await execPromise(`ls -lh ${outputPath}`);
        console.log(`Size: ${stats.stdout.split(' ')[4]}`);

        await execPromise(`rm -rf ${tempDir}`);
    } catch (error) {
        console.error('FFmpeg encoding failed:', error.message);
    }

    await browser.close();
    console.log('Recording complete!');
}

const svgPath = process.argv[2] || 'heatmap.svg';
const outputPath = process.argv[3] || 'output/heatmap.gif';
const loops = parseInt(process.argv[4]) || 1;
const fps = parseInt(process.argv[5]) || 10;

console.log(`Recording from ${svgPath} to ${outputPath}`);
console.log(`${loops} complete loop(s)`);

recordSvgAnimation(svgPath, outputPath, loops, fps).catch(console.error);