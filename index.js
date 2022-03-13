const fs = require('fs')
const util = require('util')
const stat = util.promisify(fs.stat)
const readdir = util.promisify(fs.readdir)
const readFile = util.promisify(fs.readFile)
const writeFile = util.promisify(fs.writeFile)
const path = require('path');
const utimes = require('utimes').utimes;
const piexif = require("piexifjs")
const date = require('date-and-time');

async function main() {
    const files = await readdir(process.cwd())
    await Promise.all(files.map(async file => {
        const stats = await stat(file)

        const ext = path.extname(file)

        if (ext.toLowerCase().includes("png")) {
            // png doesn't use exif..??
            return true
        }

        const b64Data = await getBase64DataFromFile(file)
        const exif = await getExifFromB64(b64Data)

        const dateTime = exif['0th'][piexif.ImageIFD.DateTime];
        const dateTimeOriginal = exif['Exif'][piexif.ExifIFD.DateTimeOriginal];
        const subsecTimeOriginal = exif['Exif'][piexif.ExifIFD.SubSecTimeOriginal];
        if (dateTime || dateTimeOriginal || subsecTimeOriginal) {
            // already has a date time
            return true
        }

        const { atimeMs, mtimeMs, ctimeMs, birthtimeMs } = stats
        const times = [atimeMs, mtimeMs, ctimeMs, birthtimeMs]
        const earliestRecord = Math.min(...times.filter(time => !isNaN(time) && time > 10))

        const newExif = {
            '0th': { ...exif['0th'] },
            'Exif': { ...exif['Exif'] },
            'GPS': { ...exif['GPS'] },
            'Interop': { ...exif['Interop'] },
            '1st': { ...exif['1st'] },
            'thumbnail': exif.thumbnail
        };

        newExif['0th'][piexif.ImageIFD.DateTime] = date.format(new Date(earliestRecord), "YYYY:MM:DD HH:mm:ss")
        newExif['Exif'][piexif.ExifIFD.DateTimeDigitized] = date.format(new Date(earliestRecord), "YYYY:MM:DD HH:mm:ss")
        if(newExif['0th'][piexif.ImageIFD.Software]){
            newExif['0th'][piexif.ImageIFD.Software] = `${newExif['0th'][piexif.ImageIFD.Software]} _ guess-image-creation-date 03 13 2022`
        }else{
            newExif['0th'][piexif.ImageIFD.Software] = `guess-image-creation-date 03 13 2022`
        }
        if(newExif['0th'][piexif.ImageIFD.ImageDescription]){
            newExif['0th'][piexif.ImageIFD.ImageDescription] = `${newExif['0th'][piexif.ImageIFD.ImageDescription]} _ with manually added creation dates`
        }else{
            newExif['0th'][piexif.ImageIFD.ImageDescription] = `with manually added creation dates`
        }

        const newExifBinary = piexif.dump(newExif);

        const newPhotoData = piexif.insert(newExifBinary, b64Data);
        let fileBuffer = Buffer.from(newPhotoData, 'binary');

        await writeFile(`adjusted_${file}`, fileBuffer)

        await utimes(`modified-${file}`, {
            btime: Math.floor(birthtimeMs || 0),
            atime: Math.floor(atimeMs || 0),
            mtime: Math.floor(mtimeMs || 0)
        })
    }))
}

const getBase64DataFromFile = async filename => (await readFile(filename)).toString('binary');
const getExifFromB64 = async b64Data => piexif.load(b64Data);

module.exports = main
