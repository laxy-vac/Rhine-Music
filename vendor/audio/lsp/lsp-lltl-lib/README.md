# lsp-lltl-lib

Low-level Template Library (LLTL) for basic data collections used in LSP Project.

This library does not aim to repeat STL. It aims to replace some important
parts of STL with generalized templates (generics). Since STL template 
instantiation may blow up the code with many additional functions, this library
tries to economy code space used by collections by generalizing data pointers.

## The Paradigm

Let's look at the paradigm by taking `std::vector` as example.

For STL `std::vector<char>` and `vector<int>` are different
types, so they will have different instances, so the code:

```C++
std::vector<char> a;
std::vector<int> b;

a.push_back('a'); // Instance 1
b.push_back(42); // Instance 2

```

will instantiate two `push_back` functions. Moreover, the code will get blown up
if these functions will get inlined.

The basic idea is, to generalize `std::vector` with two instances: a raw container
of data structures `lsp::lltl::raw_darray` and a raw container of pointers `lsp::lltl::raw_parray`.
These data structures are classic 'C' data structures inside and use `malloc`/`free` memory allocation
instead of `new[]`/`delete[]`. That makes the final code exception-safe. 

Both raw containers define their template adaptors - `lsp::lltl::darray<T>` and `lsp::lltl::parray<T>`
which declare inline methods that finally call methods of `lsp::lltl::raw_darray` and
`lsp::lltl::raw_parray` respectively.

Finally, the code above can be replaced with the following code snippet:

```C++
using namespace lsp;

lltl::darray<char> a;
lltl::darray<int> b;

a.push('a'); // Using one of the available instances of lsp::lltl::raw_darray::add()
b.push(42);  // Using the same instance of lsp::lltl::raw_darray::add()

```

**IMPORTANT!** Data structures do store plain data and do not call any constructors/destructors
to initialize/free data. This responsibility is delegated to the caller code (if not said otherwise).

Also, for automatic managment of objects and lookup, additional interfaces like `lsp::lltl::hash_spec`,
`lsp::lltl::compare_spec` and `lsp::lltl::allocator_spec` should be defined.

## Library Contents

Available collections:
  - `lltl::bitset` - set of bits stored in the optimal for the CPU form for quick data processing 
                       and memory economy. 
  - `lltl::darray` - dynamic array of plain data structures of the same type.
  - `lltl::ddeque` - double-end queue of plain data structures of the same type.
  - `lltl::hash_index` - the hash container for associating two pointers one to another.
  - `lltl::parray` - dynamic array of pointers to any data structure of the same base type.
  - `lltl::phashset` - hash set of pointers, each pointer is managed by the caller.
  - `lltl::pphash` - pointer to pointer hash map, where keys are managed automatically and values
                       are managed by caller.
  - `lltl::ptrset` - set for organize quick storage of raw pointers.
  - `lltl::shbuffer` - shared buffer for operating on memory.


Collection access:
  - `lltl::iterator` - iterator class for sequential data access.

Available inter-process and inter-thread primitive communications:
  - `lltl::state` - object for safe state transfer between Real-time and non-realtime thread.

Data manipulation interfaces:
  - `lltl::hash_iface` - inferface for defining hash function for the object.
  - `lltl::compare_iface` - interface for defining comparison routine for the object.
  - `lltl::allocator_iface` - interface for defining allocation (creating cloned copy) 
                                 and deallocation of the object.
  - `lltl::initializer_iface` - interface for defining initialization, copying and finalization of
                                 in-place stored objects. 

Available hashing functions:
  - `lltl::default_hash_func` - default hashing function used for any object if hashing specification
                                   for the object is not defined.
  - `lltl::ptr_hash_func` - hashing function for pointers (considering that it uniquely identifies the
                               object the pointer points to).
  - `lltl::char_hash_func` - hashing function for C strings present as `char *` or `const char *` types.
  
Available comparison functions:
  - `lltl::char_cmp_func` - comparison function for C strings present as `char *` or `const char *` types.
  - `lltl::ptr_cmp_func` - comparisoin function for pointers (considering that it uniquely identifies the
                               object the pointer points to).

Available allocation functions:
  - `lltl::char_copy_func` - function for copying C strings

Required specifications:
  - `lltl::hash_spec` - specification for computing hash value of the object, required by:
    - `lltl::pphash` for key object,
    - `lltl::phashset` for value object
  - `lltl::compare_spec` - specification for comparing two objects, required by:
    - `lltl::pphash` for key object,
    - `lltl::phashset` for value object
  - `lltl::allocator_spec` - specification for allocation (creating copy) and deallocation
                                of the object, required by:
    - `lltl::pphash` for key object

## Supported platforms

The build and correct unit test execution has been confirmed for following platforms:
* FreeBSD
* GNU/Linux
* Haiku
* MacOS (ARM-based)
* Windows 32-bit
* Windows 64-bit

## Requirements

The following packages need to be installed for building:

* gcc >= 4.9
* make >= 4.0

## Building

To build the library, perform the following commands:

```bash
make config # Configure the build
make fetch # Fetch dependencies from Git repository
make
sudo make install
```

To get more build options, run:

```bash
make help
```

To uninstall library, simply issue:

```bash
make uninstall
```

To clean all binary files, run:

```bash
make clean
```

To clean the whole project tree including configuration files, run:

```bash
make prune
```

Usage
=======

An example of transaction-safe widget creation:

```C++
#include <stdlib.h>
#include <lsp-plug.in/lltl/parray.h>


class Widget; // Some widget class

Widget *create(const char *type); // Some abstract factory

using namespace lsp;

bool add_widget(lltl::parray<Widget> &v, const char *type)
{
    Widget *w = create(type);
    if (!w)
        return false;
    if (v.add(w))
        return true;
    
    delete w;
    return false;
}

// Create form and replace all widgets in the passed list with
// new ones
bool create_form(lltl::parray<Widget> &list)
{
    lltl::parray<Widget> v;

    // Create widgets
    bool res = add_widget(v, "label");
    res &= add_widget(v, "edit");
    res &= add_widget(v, "label");
    res &= add_widget(v, "edit");

    // Commit the transaction
    if (res)
        list.swap(v);
    
    // Perform garbage collection
    for(size_t i=0, n=v.size(); i<n; ++i)
    	delete v[i];
    
    return res;
}


```

## SAST Tools

* [PVS-Studio](https://pvs-studio.com/en/pvs-studio/?utm_source=website&utm_medium=github&utm_campaign=open_source) - static analyzer for C, C++, C#, and Java code.

