import * as vscode from 'vscode';
import { ExecException, exec, execSync } from 'child_process';
import path = require('path');
import { config } from 'process';
import { RequestOptions, get, request } from 'https';

const logs = vscode.window.createOutputChannel("cfn-docgen")
let resourceTypes: string[] = []
// let isCLIInstalled: boolean = false
// let latestCLIVersion: string = ""

type Configuration = {
	outputRootDirectory: string
	commandPath: String
	customResourceSpecificationPath: string
	skeltonFormat: "yaml" | "json",
	region: "us-east-2" | "us-east-1" | "us-west-1" | "us-west-2" | "af-south-1" | "ap-east-1" | "ap-south-2" | "ap-southeast-3" | "ap-southeast-4" | "ap-south-1" | "ap-northeast-3" | "ap-northeast-2" | "ap-southeast-1" | "ap-southeast-2" | "ap-northeast-1" | "ca-central-1" | "eu-central-1" | "eu-west-1" | "eu-west-2" | "eu-south-1" | "eu-west-3" | "eu-south-2" | "eu-north-1" | "eu-central-2" | "il-central-1" | "me-south-1" | "me-central-1" | "sa-east-1" | "us-gov-east-1" | "us-gov-west-1"
	openPreview: boolean
	debug: boolean
}


export const getConfiguration = (): Configuration => {
	const conf = vscode.workspace.getConfiguration("cfn-docgen")
	return {
		outputRootDirectory: conf.get("OutputRootDirectory") ?? ".cfn-docgen/",
		commandPath: conf.get("CommandPath") ?? "cfn-docgen",
		customResourceSpecificationPath: conf.get("CustomResourceSpecificationPath") ?? "",
		debug: conf.get("Debug") ?? false,
		openPreview: conf.get("OpenPreview") ?? true,
		skeltonFormat: conf.get("SkeltonFormat") ?? "yaml",
		region: conf.get("Region") ?? "us-east-1",
	}

}

type PypiPackageVersion  = {
	upload_time: string
}
type PypiPackageReleases = {
	[version: string]: PypiPackageVersion[]
}
export const setCLILatestVersion = (): Promise<string> => {
	return new Promise<string>((resolve, reject) => {
		logs.appendLine('get latest cli version from PyPI')
		const reqOptions:RequestOptions = {
			hostname: "pypi.org",
			path: "/pypi/cfn-docgen/json",
			method: "GET",
			headers: {
				"Content-Type": "application/json",
			},
		}
		var data:Uint8Array[] = []
		get(reqOptions, ((res) => {
			res.on("data", ((d) => {
				data.push(d)
			}))
			res.on("end", () => {
				logs.appendLine('parse json from PyPI')
				const packageInfo = JSON.parse(Buffer.concat(data).toString())
				const releases: PypiPackageReleases = packageInfo.releases
				const sortedReleases = Object.entries(releases).sort(
					([, v1], [, v2]) => {
						return v1[0].upload_time > v2[0].upload_time ? -1 : 1
					})
				const latestVersion = sortedReleases[0][0]
				logs.appendLine(`latest cli version in PyPI is ${latestVersion}`)
				resolve(latestVersion)
			})
			res.on("error", ((error) => {
				reject(error)
			}))
		}))
	})
}

export const promptInstallLatestCLI = async (latestVersion:string, conf: Configuration) => {
	const versionCommand = `${conf.commandPath} --version`
	try {
		// check if cli is properly installed
		const stdout = execSync(versionCommand)
		logs.appendLine(stdout.toString())

		const versions = stdout.toString().match(/\d+\.\d+\.\d+/)
		if (versions === null || versions.length !== 1) {
			throw new Error("cfn-docgen may not be properly installed.")
		}
		// check if cli is latest version
		const version = versions[0]
		logs.appendLine(`current local cli version is ${version}, while latest cli version in PyPI is ${latestVersion}`)
		if (version !== latestVersion) {
			throw new Error("latest version of cfn-docgen may not be installed.")
		}

	} catch (error) {
		logs.appendLine((error as Error).message)
		vscode.window.showInformationMessage(
			`latest version of cfn-docgen may not be installed`, "Install", "Ignore",
		).then(answer => {
			// if not installed, show prompt to install latest version cli
			if (answer === "Ignore") {return}
			const installCommand = `pip install cfn-docgen --upgrade`
			vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, cancellable: false },
				async (progress) => {
					progress.report({
						message: "cfn-docgen now in installing..."
					})
					logs.appendLine(`install cfn-docgen with command: ${installCommand}`)
					exec(installCommand, async (err, stdout, stderr) => {
						if (err) {
							logs.appendLine(err.message)
							vscode.window.showErrorMessage(err.message)
							return
						}
						logs.appendLine(stdout)
						const versionInfo = execSync(versionCommand)
						logs.appendLine(versionInfo.toString())
						vscode.window.showInformationMessage(`successfull installed ${versionInfo.toString()}`)
					})
				}
			)
		})
	}
}

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

export const documentDestPath = async (source: vscode.Uri, isBatch: boolean, conf: Configuration): Promise<vscode.Uri> => {
	const workspaceFolder = await currentWorkspaceFolder()
	const baseDir = conf.outputRootDirectory
	if (isBatch) {
		const destPath = path.join(
			workspaceFolder.uri.fsPath, baseDir,
		)
		return vscode.Uri.file(destPath)
	}

	const sourceDir = path.dirname(source.fsPath)
	const destMidDir = sourceDir.replace(workspaceFolder.uri.fsPath, "")
	const sourceBasePrefix = path.basename(source.fsPath).split(".")[0]
	const destPath = path.join(
		workspaceFolder.uri.fsPath, baseDir, destMidDir, `${sourceBasePrefix}.md`
	)
	return vscode.Uri.file(destPath)
}

export const invokeDocgen = async (source: vscode.Uri, dest: vscode.Uri, isBatch: boolean, conf: Configuration) => {
	let command = `${conf.commandPath} docgen -s '${source.fsPath}' -d '${dest.fsPath}' -r ${conf.region}`
	if (conf.customResourceSpecificationPath !== "") {
		command += ` -c '${conf.customResourceSpecificationPath}'`
	}
	if (conf.debug) { command += " --debug" }

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

				if (conf.debug) { logs.appendLine(stderr) }
				logs.appendLine(stdout)
				if (stdout.includes("[ERROR]")) {
					vscode.window.showErrorMessage(stdout.split("\n").filter(s => s.startsWith("[ERROR]")).join("\n"))
				}
				if (stdout.includes("[WARNING]")) {
					vscode.window.showWarningMessage(stdout.split("\n").filter(s => s.startsWith("[WARNING]")).join("\n"))
				}
				if (stdout.includes("[INFO]")) {
					vscode.window.showInformationMessage(stdout.split("\n").filter(s => s.startsWith("[INFO]")).join("\n"))
				}
				if (!isBatch && conf.openPreview) {
					await vscode.commands.executeCommand("markdown.showPreview", dest);
				}
			})
		}
	)
}

export const invokeListResourceTypes = (conf: Configuration): string[] => {
	let command = `${conf.commandPath} skelton --list -r ${conf.region}`
	if (conf.customResourceSpecificationPath !== "") {
		command += ` -c '${conf.customResourceSpecificationPath}'`
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

export const invokeSkelton = (resourceType: string, conf: Configuration): string => {
	let command = `${conf.commandPath} skelton -t ${resourceType} -r ${conf.region}`
	if (conf.customResourceSpecificationPath !== "") {
		command += ` -c '${conf.customResourceSpecificationPath}'`
	}
	command += ` -f ${conf.skeltonFormat}`
	if (conf.debug) { command += " --debug" }
	logs.appendLine(`invoke cfn-docgen with command: ${command}`)

	try {
		const stdout = execSync(command)
		return stdout.toString().split("\n").filter(r => !r.startsWith("20") && r !== "").join("\n")
	} catch (error) {
		vscode.window.showErrorMessage(`cfn-docgen generate skelton fails for ${resourceType}. ${(error as Error).message}`)
	}
	return ""
}

export async function activate(context: vscode.ExtensionContext) {

	logs.appendLine('Congratulations, your extension "cfn-docgen-vsc-extension" is now active!');
	try {
		const conf = getConfiguration()
		const latestVersion = await setCLILatestVersion()
		promptInstallLatestCLI(latestVersion, conf)	
	} catch (error) {
		logs.appendLine((error as Error).message)
		vscode.window.showErrorMessage((error as Error).message)
	}

	let docgen = vscode.commands.registerCommand('cfn-docgen-vsc-extension.docgen', async (sourceFile: vscode.Uri | undefined) => {
		const conf = getConfiguration()

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
		const destFile = await documentDestPath(definedSourceFile, isBatch, conf)
		invokeDocgen(definedSourceFile, destFile, isBatch, conf)
	});
	context.subscriptions.push(docgen);

	let docgenBatch = vscode.commands.registerCommand('cfn-docgen-vsc-extension.docgenBatch', async (sourceDir: vscode.Uri | undefined) => {
		const conf = getConfiguration()
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
		const destDir = await documentDestPath(definedSourceDir, isBatch, conf)
		invokeDocgen(definedSourceDir, destDir, isBatch, conf)
	});
	context.subscriptions.push(docgenBatch)

	const resourceTypeSkelton = vscode.commands.registerTextEditorCommand("cfn-docgen-vsc-extension.skelton", async (editor, edit) => {
		const conf = getConfiguration()

		if (resourceTypes.length === 0) {
			resourceTypes = invokeListResourceTypes(conf)
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
		const skelton = invokeSkelton(selectedResourceType, conf)
		editor.edit((editBuilder) => {
			editBuilder.insert(editor.selection.active, skelton)
		})
	})
	context.subscriptions.push(resourceTypeSkelton)

}

export function deactivate() { }
