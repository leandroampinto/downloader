import express from 'express'
import fs from 'fs'
import { promisify } from 'util'
import path from 'path'
import { Readable } from 'stream'
import CombinedStream from 'combined-stream'

const app = express()

const rangeType = 'bytes'
const port = 3000
const dir = 'data'
const bufferSize = 2 * 1024 // 2kB

const boundary='3d6b6a416f9b5'

function handleError(res, error) {
    res.status(500).send(error)
}

function getPath(req) {
    return new Promise((resolve, reject) => {
        const fileName = req.params.fileName
        const filePath = path.resolve(dir, fileName)
        resolve(filePath)
    })
}

function parseRanges(text) {
    return new Promise((resolve, reject) => {
        const mainRegex = /(.+)=(.+)/
        
        const mainMatches = mainRegex.exec(text)
        if (!mainMatches) {
            reject(new Error(`The value "${text}" is not a valid "Range" value.`))
            return
        }
        
        const matchedRangeType = mainMatches[1]
        if (matchedRangeType !== rangeType) {
            reject(new Error(`The value "${matchedRangeType}" is not a valid "Range Type" value ("${rangeType}").`))
            return
        }

        const rangesAsText = mainMatches[2]
        const rangeSep = ', '
        const rangeAsTexts = rangesAsText.split(rangeSep)
        
        const ranges = rangeAsTexts.map(rangeAsText => {
            const rangeRegex = /([0-9]+)-([0-9]+)/
        
            const rangeMatches = rangeRegex.exec(rangeAsText)
            if (!rangeMatches) {
                reject(new Error(`The value "${rangeAsText}" is not a valid "Range" value.`))
                return
            }

            const start = parseInt(rangeMatches[1])
            const end = parseInt(rangeMatches[2])
            return ({ start, end })
        })
        resolve(ranges)
    })
}

function getOptions(req) {
    return new Promise((resolve, reject) => {
        const rangeHeader = req.get('range')
        if (rangeHeader) {
            parseRanges(rangeHeader)
                .then((ranges) => ({ ranges }))
                .then(options => resolve(options))
                .catch(reject)
        }
        else {
            const options = {}
            resolve(options)
        }
    })
}

/*
HTTP/1.1 206 Partial Content
Content-Range: bytes 0-1023/146515
*/
/*
HTTP/1.1 206 Partial Content
Content-Type: multipart/byteranges; boundary=3d6b6a416f9b5
*/

function sendFile(path, total, options, res) {
    res.set('Accept-Ranges', rangeType)
    if (options.ranges) {
        const ranges = options.ranges
        if (ranges.length === 1) {
            const range = ranges[0]
            const start = range.start
            const end = range.end
            res.status(206)
            res.set('Content-Range', `${rangeType} ${start}-${end}/${total}`)

            const stream = fs.createReadStream(path, range)
            stream.on("error", (error) => handleError(res, error))
            stream.pipe(res)
        }
        else {
            res.status(206)
            res.set('Content-Type',  `multipart/byteranges; boundary=${boundary}`)

            const combinedStream = CombinedStream.create();
            const sep = `\n--${boundary}\n`
            ranges.forEach(range => {
                    const start = range.start
                    const end = range.end
    
                    combinedStream.append(Readable.from(sep))
                    combinedStream.append(Readable.from(`Content-Range: ${rangeType} ${start}-${end}/${total}\n\n`))
                    combinedStream.append(fs.createReadStream(path, range))
                })
            combinedStream.pipe(res)
        }
    }
    else {
        const stream = fs.createReadStream(path)
        stream.on("error", (error) => handleError(res, error))
        stream.pipe(res)
    }
}

function getTotal(path) {
    const stat = promisify(fs.stat);
    return stat(path)
        .then(stats => stats.size)
}

app.get('/:fileName', (req, res) => {
    Promise
        .all([getPath(req), getOptions(req)])
        .then(([path, options]) => {
            getTotal(path)
                .then(total => {
                    sendFile(path, total, options, res)
                })
        })
})

app.listen(port)
