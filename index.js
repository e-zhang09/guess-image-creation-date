const fs = require('fs')
const util = require('util')
const stat = util.promisify(fs.stat)
const readdir = util.promisify(fs.readdir)
const readFile = util.promisify(fs.readFile)
const writeFile = util.promisify(fs.writeFile)
const mkdir = util.promisify(fs.mkdir)
const rm = util.promisify(fs.rm)
const path = require('path');
const utimes = require('utimes').utimes;
const piexif = require("piexifjs")
const date = require('date-and-time');
const mmm = require('mmmagic');
const Magic = mmm.Magic
const magic = new Magic(mmm.MAGIC_MIME_TYPE)
const sharp = require('sharp');
const os = require('os');

async function main() {
    const cwd = process.cwd()
    const curDirName = path.basename(path.resolve(cwd))
    const outDir = path.join(cwd, "..", `adjusted_${curDirName}`)
    await mkdir(outDir)

    let count = 0
    let skipped = 0
    const fileQueue = await readdir(cwd)
    while (fileQueue.length > 0) {
        const file = fileQueue.shift()
        if (!file) {
            continue
        }
        const stats = await stat(file)
        if (stats.isDirectory()) {
            fileQueue.push(...(await readdir(file)).map(_file => path.join(file, _file)))
        } else {
            const mimeType = await detectMimeType(file)

            const fileName = path.basename(file)
            let converted = false
            const tmpFile = path.join(os.tmpdir(), fileName)

            if (mimeType === "image/jpeg" || mimeType === "image/jpg") {
                // ignore
            } else if (mimeType === "image/webp") {
                await sharp(file).jpeg({
                    quality: 90
                }).toFile(tmpFile)
                converted = true
            } else {
                // currently not supporting png..? idk
                skipped++
                continue
            }

            const targetFile = converted ? tmpFile : file
            const b64Data = await getBase64DataFromFile(targetFile)
            if (converted) {
                await removeTmpFiles(tmpFile)
            }
            let error
            const exif = await getExifFromB64(b64Data).catch(err => {
                console.debug(`failed to get EXIF: ${targetFile}`)
                error = err
            })
            if (error) {
                console.error(error)
                continue
            }

            const dateTime = exif['0th'][piexif.ImageIFD.DateTime];
            const dateTimeOriginal = exif['Exif'][piexif.ExifIFD.DateTimeOriginal];
            const subsecTimeOriginal = exif['Exif'][piexif.ExifIFD.SubSecTimeOriginal];
            if (dateTime || dateTimeOriginal || subsecTimeOriginal) {
                // already has a date time
                skipped++
                continue
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
            if (newExif['0th'][piexif.ImageIFD.Software]) {
                newExif['0th'][piexif.ImageIFD.Software] = `${newExif['0th'][piexif.ImageIFD.Software]} _ guess-image-creation-date 03 13 2022`
            } else {
                newExif['0th'][piexif.ImageIFD.Software] = `guess-image-creation-date 03 13 2022`
            }
            if (newExif['0th'][piexif.ImageIFD.ImageDescription]) {
                newExif['0th'][piexif.ImageIFD.ImageDescription] = `${newExif['0th'][piexif.ImageIFD.ImageDescription]} _ with manually added creation dates`
            } else {
                newExif['0th'][piexif.ImageIFD.ImageDescription] = `with manually added creation dates`
            }
            const newExifBinary = piexif.dump(newExif);

            const newPhotoData = piexif.insert(newExifBinary, b64Data);
            let fileBuffer = Buffer.from(newPhotoData, 'binary');

            await writeFile(path.join(outDir, `adjusted_${fileName}`), fileBuffer)

            await utimes(path.join(outDir, `adjusted_${fileName}`), {
                btime: Math.floor(birthtimeMs || 0),
                atime: Math.floor(atimeMs || 0),
                mtime: Math.floor(mtimeMs || 0)
            })

            count++
        }
    }

    console.debug(`Wrote ${count} files, Skipped ${skipped} files`)
}

const detectMimeType = (file) => {
    return new Promise((res, rej) => {
        magic.detectFile(file, (err, result) => {
            if (err) rej(err)
            res(result)
        })
    })
}

const getBase64DataFromFile = async filename => (await readFile(filename)).toString('binary');
const getExifFromB64 = async b64Data => piexif.load(b64Data);

const removeTmpFiles = async (...files) => {
    await Promise.all(files.map(file => rm(file)))
}

module.exports = main
