"""
Calculator Core Logic

Provides basic arithmetic operations: addition, subtraction, multiplication, and division.
Includes error handling for division by zero.
"""

def add(a, b):
    """Return the sum of a and b."""
    return a + b


def subtract(a, b):
    """Return the difference of a minus b."""
    return a - b


def multiply(a, b):
    """Return the product of a and b."""
    return a * b


def divide(a, b):
    """
    Return the quotient of a divided by b.
    
    Raises:
        ZeroDivisionError: If b is zero.
    """
    if b == 0:
        raise ZeroDivisionError("Cannot divide by zero.")
    return a / b
