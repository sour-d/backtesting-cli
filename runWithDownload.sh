#! /bin/bash

FILENAME=$( node src/getFilename.js )
STRATEGY=$1
echo $FILENAME

node src/download.js --default
node src/addIndictors.js $FILENAME
node src/runStrategy.js $FILENAME $STRATEGY
node src/result.js $FILENAME