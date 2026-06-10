# Simple script to reverse a string and print it to the console
$originalString = "Hello World!"
$reversedString = -join $originalString[$originalString.Length..0]
Write-Output "Original: $originalString"
Write-Output "Reversed: $reversedString"
