import * as vscode from 'vscode';
import { ExecException, exec, execSync } from 'child_process';
import path = require('path');

const logs = vscode.window.createOutputChannel("cfn-docgen")

export const currentWorkspaceFolder = async () => {
	const folders = vscode.workspace.workspaceFolders ?? [];
	if (folders.length === 1) {
		return folders[0];
	} else if (folders.length > 1) {
		const folder = await vscode.window.showWorkspaceFolderPick();
		if (folder) {
			return folder;
		}
	}
	throw Error('workspace not open.');
};

export const documentDestPath = async (source: vscode.Uri, isBatch: boolean): Promise<vscode.Uri> => {
	const workspaceFolder = await currentWorkspaceFolder()
	const baseDir = vscode.workspace.getConfiguration(
		"cfn-docgen").get<string>("OutputRootDirectory"
		) ?? ".cfn-docgen"
	if (isBatch) {
		const destPath = path.join(
			workspaceFolder.uri.path, baseDir,
		)
		return vscode.Uri.file(destPath)
	}

	const sourceDir = path.dirname(source.path)
	const destMidDir = sourceDir.replace(workspaceFolder.uri.path, "")
	const sourceBasePrefix = path.basename(source.path).split(".")[0]
	const destPath = path.join(
		workspaceFolder.uri.path, baseDir, destMidDir, `${sourceBasePrefix}.md`
	)
	return vscode.Uri.file(destPath)
}

export const debug = () => {
	const debug = vscode.workspace.getConfiguration(
		"cfn-docgen").get<boolean>("Debug"
		) ?? false

	return debug
}

export const invokeDocgen = async (source: vscode.Uri, dest: vscode.Uri, isBatch:boolean) => {
	let command = `cfn-docgen docgen -s ${source.path} -d ${dest.path}`
	if (debug()) {command += " --debug"}

	vscode.window.withProgress(
		{location: vscode.ProgressLocation.Notification, cancellable: false},
		async (progress) => {
			progress.report({
				message: "cfn-docgen now in progress..."
			})

			logs.appendLine(`invoke cfn-docgen with command: ${command}`)
			exec(command, async (err, stdout, stderr) => {
				if (err) {
					logs.appendLine(err.message)
					vscode.window.showErrorMessage(err.message)
				}

				if (debug()) {logs.appendLine(stderr)}
				logs.appendLine(stdout)

				if (stdout.includes("[ERROR]")) {
					vscode.window.showErrorMessage(stdout)
					return
				}
				vscode.window.showInformationMessage(stdout)
				const openPreview = vscode.workspace.getConfiguration("cfn-docgen").get("OpenPreview") ?? true
				if (!isBatch && openPreview) {
					await vscode.commands.executeCommand("markdown.showPreview", dest);
				}
			})
		}
	)
}

export function activate(context: vscode.ExtensionContext) {

	console.log('Congratulations, your extension "cfn-docgen-vsc-extension" is now active!');

	let docgen = vscode.commands.registerCommand('cfn-docgen-vsc-extension.docgen', async (sourceFile: vscode.Uri | undefined) => {
		let definedSourceFile = sourceFile
		// give file value manually from picker
		if (definedSourceFile === undefined) {
			const files = await vscode.window.showOpenDialog({
				canSelectFiles: true, canSelectFolders: false, canSelectMany: false,
				title: "select template source file"
			})
			if (files === undefined || files.length === 0) {
				return
			}
			definedSourceFile = files[0]
		}

		const isBatch = false
		const destFile = await documentDestPath(definedSourceFile, isBatch)
		invokeDocgen(definedSourceFile, destFile, isBatch)
	});
	context.subscriptions.push(docgen);

	let docgenBatch = vscode.commands.registerCommand('cfn-docgen-vsc-extension.docgenBatch', async (sourceDir: vscode.Uri | undefined) => {
		let definedSourceDir = sourceDir

		// give folder value manually from picker
		if (definedSourceDir === undefined) {
			const dirs = await vscode.window.showOpenDialog({
				canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
				title: "select template source folder"
			})
			if (dirs === undefined || dirs.length === 0) {
				return
			}
			definedSourceDir = dirs[0]
		}
		const isBatch = true
		const destDir = await documentDestPath(definedSourceDir, isBatch)
		invokeDocgen(definedSourceDir, destDir, isBatch)
	});
	context.subscriptions.push(docgenBatch)
}

export function deactivate() { }
