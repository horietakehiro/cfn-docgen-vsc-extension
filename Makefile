.PHONY: publish package

package:
	vsce package
publish: package
	vsce publish
