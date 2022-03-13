#!/usr/bin/env node

let main = require('./index.js')

main().then(r => console.log(r)).catch(err => console.error(err))
