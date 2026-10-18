/**
 * SoundSight STEM Analyzer & OCR Pipeline
 *
 * Responsibilities:
 * 1. Receive camera/upload image
 * 2. Create a lightweight OCR-friendly image
 * 3. Run local Tesseract OCR
 * 4. Send ORIGINAL image + OCR text to Flask/Gemini
 * 5. Provide a safe local fallback if backend fails
 *
 * IMPORTANT:
 * - Original image is preserved for Gemini Vision.
 * - Processed image is used only for OCR.
 * - The analyzer is exposed globally as:
 *
 *      window.SoundSightStemAnalyzer
 *
 *   because app.js calls that object.
 */

class SoundSightStemAnalyzer {

  constructor() {
    this.currentAnalysis = null;

    console.log(
      '[STEM] SoundSight STEM Analyzer initialized'
    );
  }


  // ============================================================
  // IMAGE PREPROCESSING
  // ============================================================

  /**
   * Creates a smaller grayscale image for OCR.
   *
   * This intentionally avoids expensive full-resolution
   * pixel processing because camera images can be very large.
   *
   * The ORIGINAL image is never modified.
   */
  async preprocessImage(imageDataUrl) {

    return new Promise((resolve) => {

      const img = new Image();

      let finished = false;

      const finish = (result) => {

        if (finished) {
          return;
        }

        finished = true;

        resolve(result);
      };


      // --------------------------------------------------------
      // Safety timeout
      // --------------------------------------------------------

      const timeout = setTimeout(() => {

        console.warn(
          '[SCAN] Image preprocessing timed out.'
        );

        console.warn(
          '[SCAN] Using original image instead.'
        );

        finish(imageDataUrl);

      }, 5000);


      // --------------------------------------------------------
      // Image loaded
      // --------------------------------------------------------

      img.onload = () => {

        try {

          clearTimeout(timeout);


          const originalWidth =
            img.naturalWidth ||
            img.width ||
            1280;


          const originalHeight =
            img.naturalHeight ||
            img.height ||
            720;


          console.log(
            `[SCAN] Original image dimensions: ` +
            `${originalWidth}x${originalHeight}`
          );


          // ----------------------------------------------------
          // Resize large images
          // ----------------------------------------------------

          const MAX_DIMENSION = 1600;


          const scale = Math.min(
            1,
            MAX_DIMENSION /
              Math.max(
                originalWidth,
                originalHeight
              )
          );


          const width = Math.max(
            1,
            Math.round(
              originalWidth * scale
            )
          );


          const height = Math.max(
            1,
            Math.round(
              originalHeight * scale
            )
          );


          console.log(
            `[SCAN] OCR image dimensions: ` +
            `${width}x${height}`
          );


          // ----------------------------------------------------
          // Canvas
          // ----------------------------------------------------

          const canvas =
            document.createElement('canvas');


          canvas.width = width;
          canvas.height = height;


          const ctx =
            canvas.getContext(
              '2d',
              {
                willReadFrequently: true
              }
            );


          if (!ctx) {

            console.warn(
              '[SCAN] Canvas context unavailable.'
            );

            finish(imageDataUrl);

            return;
          }


          // ----------------------------------------------------
          // Draw resized image
          // ----------------------------------------------------

          ctx.drawImage(
            img,
            0,
            0,
            width,
            height
          );


          // ----------------------------------------------------
          // Convert to grayscale
          // ----------------------------------------------------

          const frame =
            ctx.getImageData(
              0,
              0,
              width,
              height
            );


          const pixels =
            frame.data;


          /*
           * Lightweight grayscale conversion.
           *
           * No aggressive binarization.
           * No expensive multi-pass contrast stretching.
           *
           * This keeps characters readable while preventing
           * the browser from getting stuck.
           */

          for (
            let i = 0;
            i < pixels.length;
            i += 4
          ) {

            const gray =
              0.299 * pixels[i] +
              0.587 * pixels[i + 1] +
              0.114 * pixels[i + 2];


            pixels[i] =
              gray;

            pixels[i + 1] =
              gray;

            pixels[i + 2] =
              gray;
          }


          ctx.putImageData(
            frame,
            0,
            0
          );


          // ----------------------------------------------------
          // JPEG output for OCR
          // ----------------------------------------------------

          const processed =
            canvas.toDataURL(
              'image/jpeg',
              0.88
            );


          console.log(
            '[SCAN] Image preprocessing complete'
          );


          clearTimeout(timeout);

          finish(processed);

        } catch (error) {

          clearTimeout(timeout);

          console.warn(
            '[SCAN] Image preprocessing failed:',
            error
          );


          finish(imageDataUrl);
        }
      };


      // --------------------------------------------------------
      // Image loading failure
      // --------------------------------------------------------

      img.onerror = () => {

        clearTimeout(timeout);

        console.warn(
          '[SCAN] Could not load image for preprocessing.'
        );


        finish(imageDataUrl);
      };


      // --------------------------------------------------------
      // Start loading
      // --------------------------------------------------------

      img.src = imageDataUrl;
    });
  }


  // ============================================================
  // OCR
  // ============================================================

  /**
   * Runs Tesseract OCR.
   */
  async runOcr(imageSource) {

    if (
      typeof Tesseract ===
      'undefined'
    ) {

      console.warn(
        '[SCAN] Tesseract library is not loaded.'
      );

      return '';
    }


    console.log(
      '[SCAN] Running OCR'
    );


    try {

      // --------------------------------------------------------
      // Primary Tesseract call
      // --------------------------------------------------------

      const result =
        await Tesseract.recognize(
          imageSource,
          'eng',
          {
            workerPath:
              '/js/vendor/worker.min.js',

            corePath:
              '/js/vendor/tesseract-core.wasm.js',

            langPath:
              '/js/vendor/tessdata',

            gzip: false,

            logger: (message) => {

              if (
                message &&
                typeof message.progress ===
                  'number'
              ) {

                /*
                 * Keep progress quiet.
                 * app.js controls the visible pipeline.
                 */
              }
            }
          }
        );


      const extracted =
        (
          result?.data?.text ||
          ''
        ).trim();


      console.log(
        `[SCAN] OCR result length: ${extracted.length}`
      );


      return extracted;

    } catch (error) {

      console.warn(
        '[SCAN] Primary Tesseract call failed:',
        error
      );


      // --------------------------------------------------------
      // Secondary worker fallback
      // --------------------------------------------------------

      try {

        console.log(
          '[SCAN] Trying Tesseract worker fallback'
        );


        const worker =
          await Tesseract.createWorker(
            'eng',
            1,
            {
              workerPath:
                '/js/vendor/worker.min.js',

              corePath:
                '/js/vendor/tesseract-core.wasm.js',

              langPath:
                '/js/vendor/tessdata',

              gzip: false
            }
          );


        const result =
          await worker.recognize(
            imageSource
          );


        await worker.terminate();


        const extracted =
          (
            result?.data?.text ||
            ''
          ).trim();


        console.log(
          `[SCAN] OCR fallback result length: ` +
          `${extracted.length}`
        );


        return extracted;

      } catch (workerError) {

        console.error(
          '[SCAN] OCR completely failed:',
          workerError
        );


        return '';
      }
    }
  }


  // ============================================================
  // MAIN ANALYSIS PIPELINE
  // ============================================================

  /**
   * Main entry point used by app.js.
   *
   * app.js calls:
   *
   * window.SoundSightStemAnalyzer.analyzeContent(...)
   */
  async analyzeContent({
    rawText = '',
    imageData = null,
    meta = {},
    onProgress = null
  }) {

    console.log(
      '[STEM] analyzeContent() started'
    );


    let processedImageData =
      imageData;


    let ocrText =
      (
        rawText ||
        ''
      ).trim();


    // ----------------------------------------------------------
    // IMAGE PIPELINE
    // ----------------------------------------------------------

    if (imageData) {

      console.log(
        '[SCAN] Capture started'
      );


      console.log(
        '[SCAN] Image data received'
      );


      // --------------------------------------------------------
      // Determine image type
      // --------------------------------------------------------

      let imageType =
        'image/jpeg';


      if (
        typeof imageData ===
          'string' &&
        imageData.startsWith('data:')
      ) {

        const match =
          imageData.match(
            /^data:([^;]+);/
          );


        if (match) {

          imageType =
            match[1];
        }
      }


      console.log(
        `[SCAN] Image type: ${imageType}`
      );


      console.log(
        `[SCAN] Image data length: ${imageData.length}`
      );


      // --------------------------------------------------------
      // Detect image dimensions
      // --------------------------------------------------------

      try {

        const imageInfo =
          await new Promise(
            (resolve) => {

              const img =
                new Image();


              img.onload = () => {

                resolve({
                  width:
                    img.naturalWidth ||
                    img.width ||
                    0,

                  height:
                    img.naturalHeight ||
                    img.height ||
                    0
                });

              };


              img.onerror = () => {

                resolve({
                  width: 0,
                  height: 0
                });

              };


              img.src =
                imageData;
            }
          );


        console.log(
          `[SCAN] Image size: ` +
          `${imageInfo.width}x${imageInfo.height}`
        );

      } catch (error) {

        console.warn(
          '[SCAN] Could not determine image dimensions:',
          error
        );
      }


      // --------------------------------------------------------
      // STEP: preprocessing
      // --------------------------------------------------------

      console.log(
        '[SCAN] Running image preprocessing'
      );


      if (onProgress) {

        onProgress(
          'preprocessing'
        );
      }


      processedImageData =
        await this.preprocessImage(
          imageData
        );


      console.log(
        '[SCAN] Preprocessing finished'
      );


      // --------------------------------------------------------
      // STEP: OCR
      // --------------------------------------------------------

      if (
        !ocrText ||
        ocrText.length === 0
      ) {

        if (onProgress) {

          onProgress(
            'ocr'
          );
        }


        ocrText =
          await this.runOcr(
            processedImageData
          );

      } else {

        console.log(
          '[SCAN] OCR text already supplied.'
        );


        console.log(
          `[SCAN] Supplied OCR length: ` +
          `${ocrText.length}`
        );
      }


      console.log(
        `[SCAN] Final OCR length: ${ocrText.length}`
      );


      console.log(
        '[SCAN] Sending captured image for analysis'
      );
    }


    // ----------------------------------------------------------
    // STEP: STEM understanding
    // ----------------------------------------------------------

    if (onProgress) {

      onProgress(
        'stem'
      );
    }


    console.log(
      '[STEM] Sending data to backend'
    );


    // ----------------------------------------------------------
    // BACKEND / GEMINI
    // ----------------------------------------------------------

    try {

      const response =
        await fetch(
          '/api/analyze',
          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/json'
            },

            body:
              JSON.stringify({

                /*
                 * OCR text supports Gemini.
                 */
                rawText:
                  ocrText,


                /*
                 * IMPORTANT:
                 *
                 * Send the ORIGINAL image.
                 *
                 * Gemini Vision should see the original
                 * diagram, flowchart, graph, formula, code,
                 * colors and spatial relationships.
                 */
                imageData:
                  imageData,


                /*
                 * Keep processed OCR image separately.
                 *
                 * server.py may ignore this currently,
                 * but retaining it makes the data contract clear.
                 */
                ocrImageData:
                  processedImageData,


                meta
              })
          }
        );


      if (!response.ok) {

        throw new Error(
          `Server returned HTTP ${response.status}`
        );
      }


      const data =
        await response.json();


      if (
        data &&
        data.success &&
        data.result
      ) {

        console.log(
          '[STEM] Backend analysis successful'
        );


        this.currentAnalysis =
          data.result;


        return data.result;
      }


      throw new Error(
        data?.error ||
        'Backend analysis returned no result.'
      );


    } catch (error) {

      console.warn(
        '[STEM] Backend analysis failed.'
      );


      console.warn(
        '[STEM] Using local fallback:',
        error
      );


      // --------------------------------------------------------
      // LOCAL FALLBACK
      // --------------------------------------------------------

      const fallback =
        this.clientSideStemEngine(
          ocrText,
          processedImageData ||
            imageData,
          meta
        );


      this.currentAnalysis =
        fallback;


      return fallback;
    }
  }


  // ============================================================
  // LOCAL FALLBACK STEM ENGINE
  // ============================================================

  /**
   * Safe offline fallback.
   *
   * IMPORTANT:
   * This does NOT pretend to understand diagrams or flowcharts.
   * If visual understanding is unavailable, it explicitly says so.
   */
  clientSideStemEngine(
    rawText,
    imageData,
    meta
  ) {

    const text =
      (
        rawText ||
        ''
      ).trim();


    const meaningfulChars =
      text.replace(
        /[^a-zA-Z0-9]/g,
        ''
      );


    // ----------------------------------------------------------
    // Nothing readable
    // ----------------------------------------------------------

    if (
      meaningfulChars.length < 6
    ) {

      return {

        isError: true,

        error:
          'Unable to process the captured image.',

        reason:
          'No readable text detected.',

        message:
          'I could not detect enough readable STEM text from this scan. Please hold the document steady, use good lighting, and move the camera closer.',

        ocrText:
          text,

        title:
          meta?.title ||
          'Unreadable STEM Content',

        topic:
          'Unknown',

        contentType:
          'Unknown',

        confidence:
          0,

        isPartiallyUnclear:
          true,

        certainty: {

          isClear:
            false,

          certain:
            [],

          uncertain:
            [
              'The captured content could not be read reliably.'
            ],

          missing:
            [
              'Readable STEM content.'
            ]
        },

        imageData
      };
    }


    const lines =
      text
        .split('\n')
        .map(
          line =>
            line.trim()
        )
        .filter(Boolean);


    const lower =
      text.toLowerCase();


    // ==========================================================
    // CODE DETECTION
    // ==========================================================

    const codeKeywords = [

      'def ',

      'import ',

      'from ',

      'class ',

      'return',

      'for ',

      'while ',

      'print',

      'range(',

      'if ',

      'elif ',

      'else:',

      'function ',

      'const ',

      'let ',

      'var ',

      'public static',

      'system.out',

      '#include'

    ];


    const codeHits =
      codeKeywords.filter(
        keyword =>
          lower.includes(keyword)
      ).length;


    const looksLikeCode =
      codeHits >= 2 ||
      (
        codeHits >= 1 &&
        (
          text.includes('{') ||
          text.includes('}') ||
          text.includes(';') ||
          text.includes('():')
        )
      );


    if (looksLikeCode) {

      const lineByLine =
        [];

      const functions =
        [];


      lines.forEach(
        (line, index) => {

          const lineNumber =
            index + 1;


          // Python function
          if (
            /^def\s+/i.test(line)
          ) {

            const match =
              line.match(
                /def\s+([a-zA-Z0-9_]+)\s*\((.*?)\)/
              );


            const functionName =
              match
                ? match[1]
                : 'function';


            const parameters =
              match
                ? (
                    match[2] ||
                    'none'
                  )
                : 'none';


            functions.push(
              functionName
            );


            lineByLine.push(
              `Line ${lineNumber}: Defines function ${functionName} with parameters ${parameters}.`
            );


            return;
          }


          // Python for
          if (
            /^for\s+/i.test(line)
          ) {

            lineByLine.push(
              `Line ${lineNumber}: Starts a loop using ${line}.`
            );


            return;
          }


          // Python while
          if (
            /^while\s+/i.test(line)
          ) {

            lineByLine.push(
              `Line ${lineNumber}: Starts a while loop using the condition ${line.replace(/^while/i, '').replace(':', '').trim()}.`
            );


            return;
          }


          // if
          if (
            /^if\s+/i.test(line)
          ) {

            lineByLine.push(
              `Line ${lineNumber}: Checks the condition ${line.replace(/^if/i, '').replace(':', '').trim()}.`
            );


            return;
          }


          // elif
          if (
            /^elif\s+/i.test(line)
          ) {

            lineByLine.push(
              `Line ${lineNumber}: Checks an alternative condition.`
            );


            return;
          }


          // else
          if (
            /^else\s*:/i.test(line)
          ) {

            lineByLine.push(
              `Line ${lineNumber}: Executes the alternative branch when the earlier condition is false.`
            );


            return;
          }


          // return
          if (
            /^return\b/i.test(line)
          ) {

            const returnedValue =
              line
                .replace(
                  /^return/i,
                  ''
                )
                .trim();


            lineByLine.push(
              `Line ${lineNumber}: Returns ${returnedValue || 'a value'}.`
            );


            return;
          }


          // print
          if (
            /\bprint\s*\(/i.test(line)
          ) {

            lineByLine.push(
              `Line ${lineNumber}: Produces output using ${line}.`
            );


            return;
          }


          // import
          if (
            /^(import|from)\s+/i.test(line)
          ) {

            lineByLine.push(
              `Line ${lineNumber}: Imports ${line}.`
            );


            return;
          }


          // Generic code line
          lineByLine.push(
            `Line ${lineNumber}: Contains the statement ${line}.`
          );
        }
      );


      const title =
        functions.length > 0
          ? `Program: ${functions[0]}`
          : 'STEM Code';


      const audioScript =
        [
          'I detected programming code.',

          functions.length > 0
            ? `The main function is ${functions[0]}.`
            : '',

          lineByLine.join(' '),

          'This is a local fallback explanation. For full visual STEM understanding, the Gemini analysis should be used.'
        ]
          .filter(Boolean)
          .join(' ');


      return {

        isError:
          false,

        title,

        topic:
          'Programming Logic',

        contentType:
          'Code',

        language:
          'Detected from scanned text',

        confidence:
          0.70,

        isPartiallyUnclear:
          true,

        ocrText:
          text,

        purpose:
          functions.length > 0
            ? `The scanned code defines and uses the function ${functions[0]}.`
            : 'The scanned material contains programming statements.',

        overallLogic:
          'The local fallback can describe readable code statements, but it cannot reliably infer visual relationships that are not present in the OCR text.',

        lineByLine,

        keyPoints: [

          'Programming code was detected.',

          `The scan contains approximately ${lines.length} readable lines.`,

          functions.length > 0
            ? `Detected function: ${functions.join(', ')}.`
            : 'No clear function declaration was detected.'

        ],

        audioScript,

        certainty: {

          isClear:
            false,

          certain: [
            'Readable programming syntax was detected from OCR.'
          ],

          uncertain: [
            'Some code structure may have been lost during OCR.'
          ],

          missing: [
            'Visual relationships that are not represented in the OCR text.'
          ]
        },

        imageData
      };
    }



        if (meaningfulChars.length < 40) {
      return {
        isError: true,
        message: 'I could not analyze this image right now. Please try again in a moment.',
        title: 'Analysis Unavailable',
        topic: 'Unknown',
        contentType: 'Unknown',
        confidence: 0,
        ocrText: text,
        imageData
      };
    }
    
    // ==========================================================
    // GENERAL TEXT / STEM FALLBACK
    // ==========================================================

    const title =
      meta?.title ||
      (
        lines[0]
          ? lines[0].substring(
              0,
              60
            )
          : 'STEM Study Material'
      );


    const summary =
      lines
        .slice(
          0,
          4
        )
        .join(' ');


    const keyPoints =
      lines
        .slice(
          0,
          6
        );


    return {

      isError:
        false,

      title,

      topic:
        'STEM Study Material',

      contentType:
        'Text',

      confidence:
        0.70,

      isPartiallyUnclear:
        true,

      ocrText:
        text,

      purpose:
        summary,

      summary,

      keyPoints,

      audioScript:
        `I detected readable STEM study text. ${summary}. Some visual structure may not be available in the local fallback. For a complete explanation of diagrams, graphs, formulas or flowcharts, the Gemini Vision analysis is required.`,

      certainty: {

        isClear:
          false,

        certain: [
          'Readable text was extracted from the scan.'
        ],

        uncertain: [
          'The local fallback cannot reliably determine the complete visual structure of the material.'
        ],

        missing: [
          'Any information that exists only visually and was not captured by OCR.'
        ]
      },

      imageData
    };
  }
}


// ============================================================
// GLOBAL SINGLETON
// ============================================================
//
// THIS LINE IS CRITICAL.
//
// app.js uses:
//
// window.SoundSightStemAnalyzer.analyzeContent(...)
//
// Therefore the analyzer MUST be attached to window.
//
// ============================================================

window.SoundSightStemAnalyzer =
  new SoundSightStemAnalyzer();


console.log(
  '[STEM] window.SoundSightStemAnalyzer is ready'
);