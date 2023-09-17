import * as assert from 'assert';
import { Workbench } from 'vscode-extension-tester';
import * as vscode from 'vscode';
import { currentWorkspaceFolder, documentDestPath, invokeDocgen } from '../../extension';
import itParam from 'mocha-param';
import { expect } from "chai";
import path = require('path');


suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test("get current working folder", async () => {
		const folder = await currentWorkspaceFolder();
		assert.equal(folder.name, "test-ws");
	});

	test("get document dest path from template source path", async () => {
		const source = vscode.Uri.file(
			path.resolve(path.join(__dirname, "../../../src/test/test-ws/subdir/sample-template.yaml"))
		);
		const expected = vscode.Uri.file(
			path.resolve(path.join(__dirname, "../../../src/test/test-ws/.cfn-docgen/subdir/sample-template.md"))
		);
		const dest = await documentDestPath(source, false)
		assert.equal(dest.toString(), expected.toString())
	});
});
