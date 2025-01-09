var vscode = require('vscode');
var fs = require('fs');
var replaceExt = require('replace-ext');
var compileSass = require('./lib/sass.node.spk.js');
var pathModule = require('path');

var CompileSassExtension = function() {

    // Private fields ---------------------------------------------------------

    // Constructor ------------------------------------------------------------
    const getConfiguration = ()=> vscode.workspace.getConfiguration('easysass-ng');
    const outputChannel = vscode.window.createOutputChannel("EasySassNg");

    // Private functions ------------------------------------------------------

    // Processes result of css file generation.
    function handleResult(outputPath, result) {

        if (result.status == 0) {

            try {                
                fs.writeFileSync(outputPath, result.text, { flags: "w" });
            } catch (e) {
                outputChannel.appendLine("Failed to generate CSS: " + e);
            }

            outputChannel.appendLine("Successfully generated CSS: " + outputPath);
        }
        else {

            if (result.formatted) {
                outputChannel.appendLine(result.formatted);
            } else if (result.message) {
                outputChannel.appendLine(result.message);
            } else {
                outputChannel.appendLine("Failed to generate CSS from SASS, but the error is unknown.");
            }

            vscode.window.showErrorMessage('EasySass: could not generate CSS file. See Output panel for details.');
            outputChannel.show(true);
        }
    }

    // Generates target path for scss/sass file basing on its path
    // and easysass.targetDir setting. If the setting specifies
    // relative path, current workspace folder is used as root.
    function generateTargetPath(path) {

        var configuration = getConfiguration();

        var targetDir = pathModule.dirname(path);
        var filename = pathModule.basename(path);
        if (configuration.targetDir != undefined && configuration.targetDir.length > 0) {

            if (pathModule.isAbsolute(configuration.targetDir)) {
                targetDir = configuration.targetDir;
            } else {
                var folder = vscode.workspace.rootPath;
                if (folder == undefined) {
                    throw "Path specified in easysass.targetDir is relative, but there is no open folder in VS Code!";
                }

                targetDir = pathModule.join(folder, configuration.targetDir);
            }
        }

        return {
            targetDir: targetDir,
            filename: filename
        };
    }

    // Compiles single scss/sass file.
    function compileFile(path) {
        var configuration = getConfiguration();

        var outputPathData = generateTargetPath(path);

        // Iterate through formats from configuration

        if (configuration.formats.length == 0) {
            throw "No formats are specified. Define easysass.formats setting (or remove to use defaults)";
        }

        for (var i = 0; i < configuration.formats.length; i++) {

            var format = configuration.formats[i];
        
            // Evaluate style for sass generator
            var style;
            switch (format.format) {
                case "nested":
                    style = compileSass.Sass.style.nested;
                    break;
                case "compact":
                    style = compileSass.Sass.style.compact;
                    break;
                case "expanded":
                    style = compileSass.Sass.style.expanded;
                    break;
                case "compressed":
                    style = compileSass.Sass.style.compressed;
                    break;
                default:
                    throw "Invalid format specified for easysass.formats[" + i + "]. Look at setting's hint for available formats.";
            }

            // Check target extension
            if (format.extension == undefined || format.extension.length == 0)
                throw "No extension specified for easysass.formats[" + i + "].";

            var targetPath = pathModule.join(outputPathData.targetDir, replaceExt(outputPathData.filename, format.extension));

            // Using closure to properly pass local variables to callback
            (function(path_, targetPath_, style_) {

                // Run the compilation process
                compileSass(path_, { style: style_ }, function(result) {
                                        
                    handleResult(targetPath_, result);
                });

            })(path, targetPath, style);
        }        
    }

    // Checks, if the file matches the exclude regular expression
    function checkExclude(filename) {
        
        var configuration = getConfiguration();
        return configuration.excludeRegex.length > 0 && new RegExp(configuration.excludeRegex).test(filename);
    }
    const relatedRegexp = new RegExp(`@import\\s+(['"])(.+?)\\1`, 'g');
    async function getRelatedFiles(filepath) {
        const files = await vscode.workspace.findFiles("**/*.s[ac]ss");
        
        return files.filter(function (file) {
            const fileContent = fs.readFileSync(file.fsPath);
            let result = null;
            while (result = relatedRegexp.exec(fileContent)) {
                //把import中的路径解析成绝对路径
                const absPath = pathModule.resolve(pathModule.dirname(file.fsPath), result[2]);
                return filepath.startsWith(absPath);
            }
        });
    }

    /**
     * 
     * @param {vscode.URI[]} files 
     */
    function compileFiles(files){
        if(!Array.isArray(files) || files.length == 0){
            return;
        }
        const configuration = getConfiguration();
        const checkExclude = (filename) => configuration.excludeRegex.length > 0 && new RegExp(configuration.excludeRegex).test(filename);
        try {
            for (var i = 0; i < files.length; i++) {
                var filename = pathModule.basename(files[i].fsPath);
                if (checkExclude(filename)) {
                    outputChannel.appendLine("File " + filename + " is excluded from building to CSS. Check easysass.excludeRegex setting.");
                    continue;
                }
                compileFile(files[i].fsPath);
            }
        }
        catch (e) {
            vscode.window.showErrorMessage('EasySass: could not generate CSS file: ' + e);
        }  
    }

    // Public -----------------------------------------------------------------

    return {

        OnSave: async function (document) {
            try {
                const configuration = getConfiguration();
                const filename = pathModule.basename(document.fileName);
                if (configuration.compileAfterSave) {
                    const lowerCase = filename.toLocaleLowerCase();
                    if (lowerCase.endsWith('.scss') || lowerCase.endsWith('.sass')) {
                        if (!checkExclude(filename)) {
                            compileFile(document.fileName);                
                        } else {
                            outputChannel.appendLine("File " + document.fileName + " is excluded from building to CSS. Check easysass.excludeRegex setting.");
                        }
                        // 编译引用本文件的sass文件
                        if(configuration.compileRelatedFiles){
                            const relatedFiles = await getRelatedFiles(document.fileName);
                            if(relatedFiles && relatedFiles.length > 0){
                                outputChannel.appendLine("Do compile related files: ")
                                compileFiles(relatedFiles);
                            }
                        }
                    }
                }
            }
            catch (e) {
                vscode.window.showErrorMessage('EasySass: could not generate CSS file: ' + e);
                outputChannel.appendLine('EasySass: could not generate CSS file: ' + e.message);
                outputChannel.appendLine(e.stack);
            }
        },
        CompileAll: function() {
            outputChannel.appendLine('EasySass: do compile all files action.');
            vscode.workspace.findFiles("**/*.s[ac]ss").then(compileFiles);            
        }
    };
};

function activate(context) {

    var extension = CompileSassExtension();

    vscode.workspace.onDidSaveTextDocument(function(document) { extension.OnSave(document) });

    var disposable = vscode.commands.registerCommand('easysass-ng.compileAll', function() {
        extension.CompileAll();
    });

    context.subscriptions.push(disposable);
}

function deactivate() {
}

exports.activate = activate;
exports.deactivate = deactivate;
