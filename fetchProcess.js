const fs = require('fs');
const path = require('path');
const OUTPUT_FILE = path.join('sacredmusic','lastScript.js');

async function processHTMLlibrary(url) {
    if( !fs.existsSync(path.join('sacredmusic', 'api')) ){
        fs.mkdirSync(path.join('sacredmusic', 'api'), { recursive: true });
    }
    try {
        const response = await globalThis.fetch(url);
        const html = await response.text();

        const JsonText = html.split('window.renderData=')[1]?.split('</script>')[0];

        if (JsonText) {
            fs.writeFileSync(path.join('sacredmusic', 'main.json'), JsonText, 'utf8');
            const parsedJSON = JSON.parse(JsonText);

            processEntry(parsedJSON.data.libraryData);

            console.log(`Saved last script to ${OUTPUT_FILE}`);
        } else {
            console.log('No scripts found.');
        }
    } catch (error) {
        console.error('Error fetching or processing:', error);
    }
}

async function processEntry(entryJson){
    console.log(entryJson['$model'], " ", entryJson.title, " ", entryJson.slug);
    if(entryJson['$model'] !== 'musicLibraryItem'){
        for(const entry of entryJson.entries){
            processEntry(entry);
        }
    }
    else{
        const response = await (await globalThis.fetch(`https://www.churchofjesuschrist.org/media/music/api?type=songsFilteredList&lang=eng&identifier=%7B%22lang%22%3A%22eng%22%2C%22limit%22%3A500%2C%22offset%22%3A0%2C%22orderByKey%22%3A%5B%22bookSongPosition%22%5D%2C%22bookQueryList%22%3A%5B%22${entryJson.slug}%22%5D%7D&batchSize=20`)).json();
        fs.writeFileSync(path.join('sacredmusic', 'api', `${entryJson.slug}.json`), JSON.stringify(response.data, null, 2), 'utf8');
        for(const song of response.data){
            console.log(song.title, " ", song.bookSectionTitle, " ", song.slug);
        }
    }
}

processHTMLlibrary("https://www.churchofjesuschrist.org/media/music?lang=eng");