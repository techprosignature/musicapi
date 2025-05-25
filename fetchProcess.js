const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const URL = "https://www.churchofjesuschrist.org/media/music?lang=eng"; // Replace with the actual URL
const OUTPUT_FILE = path.join('sacredmusic','lastScript.js');

async function fetchAndExtract() {
    try {
        const response = await globalThis.fetch(URL);
        const html = await response.text();

        const dom = new JSDOM(html);
        const scripts = [...dom.window.document.querySelectorAll('script')];

        const lastScript = scripts.length ? scripts[scripts.length - 4].textContent : null;
        const mainJson = lastScript.split('window.renderData=')[1];

        if (mainJson) {
            fs.writeFileSync(path.join('sacredmusic', 'main.json'), mainJson, 'utf8');

            console.log(`Saved last script to ${OUTPUT_FILE}`);
        } else {
            console.log('No scripts found.');
        }
    } catch (error) {
        console.error('Error fetching or processing:', error);
    }
}

fetchAndExtract();