import * as vscode from 'vscode';
import { ExecException, exec, execSync } from 'child_process';
import path = require('path');

const logs = vscode.window.createOutputChannel("cfn-docgen")
let resourceTypes: string[] = []

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

export const invokeDocgen = async (source: vscode.Uri, dest: vscode.Uri, isBatch: boolean) => {
	let command = `cfn-docgen docgen -s ${source.path} -d ${dest.path}`
	const customResourceSpecification = vscode.workspace.getConfiguration(
		"cfn-docgen"
	).get<string | null>("CustomResourceSpecificationPath")
	if (customResourceSpecification !== undefined && customResourceSpecification !== "") {
		command += ` -c ${customResourceSpecification}`
	}
	if (debug()) { command += " --debug" }

	vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, cancellable: false },
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

				if (debug()) { logs.appendLine(stderr) }
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

export const invokeListResourceTypes = (): string[] => {
	let command = `cfn-docgen skelton --list`
	const customResourceSpecification = vscode.workspace.getConfiguration(
		"cfn-docgen"
	).get<string | null>("CustomResourceSpecificationPath")
	if (customResourceSpecification !== undefined && customResourceSpecification !== "") {
		command += ` -c ${customResourceSpecification}`
	}
	logs.appendLine(`invoke cfn-docgen with command: ${command}`)
	let resourceTypes: string[] = []
	try {
		const stdout = execSync(command)
		resourceTypes = stdout.toString().split("\n").filter(r => !r.startsWith("20") && r !== "")
	} catch (error) {
		vscode.window.showErrorMessage(`cfn-docgen fails: ${(error as Error).message}`)
	}
	return resourceTypes
}

export const invokeSkelton = (resourceType: string): string => {
	let command = `cfn-docgen skelton -t ${resourceType}`

	const customResourceSpecification = vscode.workspace.getConfiguration(
		"cfn-docgen"
	).get<string | null>("CustomResourceSpecificationPath")
	if (customResourceSpecification !== undefined && customResourceSpecification !== "") {
		command += ` -c ${customResourceSpecification}`
	}

	const format = vscode.workspace.getConfiguration(
		"cfn-docgen"
	).get<string>("SkeltonFormat")
	if (format !== undefined) {
		command += ` -f ${format}`
	}

	if (debug()) { command += " --debug" }
	logs.appendLine(`invoke cfn-docgen with command: ${command}`)

	try {
		const stdout = execSync(command)
		return stdout.toString().split("\n").filter(r => !r.startsWith("20") && r !== "").join("\n")
	} catch (error) {
		vscode.window.showErrorMessage(`cfn-docgen generate skelton fails for ${resourceType}. ${(error as Error).message}`)
	}
	return ""
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

	const resourceTypeSkelton = vscode.commands.registerTextEditorCommand("cfn-docgen-vsc-extension.skelton", async (editor, edit) => {
		if (resourceTypes.length === 0) {
			resourceTypes = invokeListResourceTypes()
			if (resourceTypes.length === 0) {
				return
			}
		}
		const selectedResourceType = await vscode.window.showQuickPick(
			resourceTypes,
			{
				canPickMany: false,
				ignoreFocusOut: false,
				title: "select resource type",
			}
		)

		if (selectedResourceType === undefined) {
			return
		}
		logs.appendLine(`selected resource type is ${selectedResourceType}`)
		const skelton = invokeSkelton(selectedResourceType)
		editor.edit((editBuilder) => {
			editBuilder.insert(editor.selection.active, skelton)
		})
	})
	context.subscriptions.push(resourceTypeSkelton)

}

export function deactivate() { }
