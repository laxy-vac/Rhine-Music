/*
 * Copyright (C) 2025 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2025 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 24 июл. 2019 г.
 *
 * lsp-runtime-lib is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * any later version.
 *
 * lsp-runtime-lib is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with lsp-runtime-lib. If not, see <https://www.gnu.org/licenses/>.
 */

#ifndef LSP_PLUG_IN_IPC_PROCESS_H_
#define LSP_PLUG_IN_IPC_PROCESS_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/runtime/LSPString.h>
#include <lsp-plug.in/common/types.h>
#include <lsp-plug.in/common/status.h>
#include <lsp-plug.in/io/IInStream.h>
#include <lsp-plug.in/io/IOutStream.h>
#include <lsp-plug.in/lltl/parray.h>

#include <unistd.h>

namespace lsp
{
    namespace ipc
    {
        /**
         * Class for running processes
         */
        class Process
        {
            public:
                enum pstatus_t {
                    PSTATUS_CREATED,
                    PSTATUS_RUNNING,
                    PSTATUS_EXITED,
                    PSTATUS_ERROR,
                    PSTATUS_RUNNING_ERROR
                };

            private:
                typedef struct envvar_t {
                    LSPString   name;
                    LSPString   value;
                } envvar_t;

#ifdef PLATFORM_WINDOWS
                typedef void           *HANDLE;
#endif /* PLATFORM_WINDOWS */

            private:
                LSPString               sCommand;
                lltl::parray<LSPString> vArgs;
                lltl::parray<envvar_t>  vEnv;
                pstatus_t               nStatus;
                int                     nExitCode;

#ifdef PLATFORM_WINDOWS
                uint32_t                nPID;
                HANDLE                  hProcess;
                HANDLE                  hStdIn;
                HANDLE                  hStdOut;
                HANDLE                  hStdErr;
#else
                pid_t                   nPID;
                int                     hStdIn;
                int                     hStdOut;
                int                     hStdErr;
#endif /* PLATFORM_WINDOWS */

                io::IOutStream         *pStdIn;
                io::IInStream          *pStdOut;
                io::IInStream          *pStdErr;

            protected:
                static void     destroy_args(lltl::parray<LSPString> *args);
                static void     destroy_env(lltl::parray<envvar_t> *env);
                void            close_handles();

#ifdef PLATFORM_WINDOWS
                static status_t append_arg_escaped(LSPString *dst, const LSPString *value);
                status_t        build_argv(LSPString *dst);
                status_t        build_envp(LSPString *dst);
#else
                status_t        build_argv(lltl::parray<char> *dst);
                status_t        build_envp(lltl::parray<char> *dst);
                status_t        spawn_process(const char *cmd, char * const *argv, char * const *envp);
                status_t        vfork_process(const char *cmd, char * const *argv, char * const *envp);
                status_t        fork_process(const char *cmd, char * const *argv, char * const *envp);
                void            execvpe_process(const char *cmd, char * const *argv, char * const *envp, bool soft_exit);
#endif /* PLATFORM_WINDOWS */

            public:
                explicit Process();
                Process(const Process &) = delete;
                Process(Process &&) = delete;
                ~Process();

                Process & operator = (const Process &) = delete;
                Process & operator = (Process &&) = delete;

            public:
                /**
                 * Set command for execution
                 * @param cmd command to execute
                 * @return status of operation
                 */
                status_t    set_command(const LSPString *cmd);

                /**
                 * Set command for execution
                 * @param cmd command to execute in UTF-8 encoding
                 * @return status of operation
                 */
                status_t    set_command(const char *cmd);

            public:
                /**
                 * Get overall number of additional command-line arguments
                 * @return number of additional command-line arguments
                 */
                size_t      args() const;

                /**
                 * Add argument at the end of command line
                 * @param value argument value
                 * @return status of operation
                 */
                status_t    add_arg(const LSPString *value);

                /**
                 * Add argument at the end of command line
                 * @param value argument value in UTF-8 encoding
                 * @return status of operation
                 */
                status_t    add_arg(const char *value);

                /**
                 * Set value of argument at the specified place
                 * @param value argument value
                 * @return status of operation
                 */
                status_t    set_arg(size_t index, const LSPString *value);

                /**
                 * Set value of argument at the specified place
                 * @param value argument value in UTF-8 encoding
                 * @return status of operation
                 */
                status_t    set_arg(size_t index, const char *value);

                /**
                 * Get value of argument at the specified place
                 * @param value pointer to store argument value
                 * @return status of operation
                 */
                status_t    get_arg(size_t index, LSPString *value);

                /**
                 * Get value of argument at the specified place
                 * @param value pointer to store argument value
                 * @return status of operation
                 */
                status_t    get_arg(size_t index, char **value);

                /**
                 * Remove the argument at the specified place
                 * @param value pointer to store value of removed argument
                 * @return status of operation
                 */
                status_t    remove_arg(size_t index, LSPString *value = NULL);

                /**
                 * Remove the argument at the specified place
                 * @param value pointer to store value of removed argument.
                 *        The pointer should be free()'d after use
                 * @return status of operation
                 */
                status_t    remove_arg(size_t index, char **value = NULL);

                /**
                 * Insert argument at the specified position
                 * @param value argument value
                 * @return status of operation
                 */
                status_t    insert_arg(size_t index, const LSPString *value);

                /**
                 * Insert argument at the specified position
                 * @param value argument value in UTF-8 encoding
                 * @return status of operation
                 */
                status_t    insert_arg(size_t index, const char *value);

                /**
                 * Clear arguments;
                 * @return status of operation
                 */
                status_t    clear_args();

            public:
                /**
                 * Return number of environment variables
                 * @return number of environment variables
                 */
                size_t      envs() const;

                /**
                 * Set value of the specific environment variable
                 * @param key the name of environment variable
                 * @param value the value of environment variable
                 * @return status of operation
                 */
                status_t    set_env(const LSPString *key, const LSPString *value);

                /**
                 * Set value of the specific environment variable
                 * @param key the name of environment variable in UTF-8 encoding
                 * @param value the value of environment variable in UTF-8 encoding
                 * @return status of operation
                 */
                status_t    set_env(const char *key, const char *value);

                /**
                 * Remove the specific environment variable
                 * @param key the name of environment variable
                 * @param value pointer to store value of the removed environment variable
                 * @return status of operation
                 */
                status_t    remove_env(const LSPString *key, LSPString *value = NULL);

                /**
                 * Remove the specific environment variable
                 * @param key the name of environment variable
                 * @param value pointer to store value of the removed environment variable
                 * @return status of operation
                 */
                status_t    remove_env(const char *key, LSPString *value = NULL);

                /**
                 * Remove the specific environment variable
                 * @param key the name of environment variable in UTF-8 encoding
                 * @param value pointer to store value of the removed environment variable in UTF-8 encoding.
                 *        The obtained pointer should be free()'d after use
                 * @return status of operation
                 */
                status_t    remove_env(const char *key, char **value = NULL);

                /**
                 * Obtain the value of the specific environment variable
                 * @param key the name of environment variable
                 * @param value pointer to store value of the environment variable
                 * @return status of operation
                 */
                status_t    get_env(const LSPString *key, LSPString *value = NULL);

                /**
                 * Obtain the value of the specific environment variable
                 * @param key the name of environment variable
                 * @param value pointer to store value of the environment variable
                 * @return status of operation
                 */
                status_t    get_env(const char *key, LSPString *value = NULL);

                /**
                 * Obtain the value of the specific environment variable
                 * @param key the name of environment variable in UTF-8 encoding
                 * @param value pointer to store value of the environment variable in UTF-8 encoding.
                 *        The obtained pointer should be free()'d after use
                 * @return status of operation
                 */
                status_t    get_env(const char *key, char **value = NULL);

                /**
                 * Obtain the key and value of environment variable by index
                 * @param idx the environment variable index
                 * @param key environment variable key
                 * @param value environment variable value
                 * @return status of operation
                 */
                status_t    read_env(size_t idx, LSPString *key = NULL, LSPString *value = NULL);

                /**
                 * Obtain the value of the specific environment variable
                 * @param idx the environment variable index
                 * @param key the name of environment variable in UTF-8 encoding
                 *        The obtained pointer should be free()'d after use
                 * @param value pointer to store value of the environment variable in UTF-8 encoding.
                 *        The obtained pointer should be free()'d after use
                 * @return status of operation
                 */
                status_t    read_env(size_t idx, char **key = NULL, char **value = NULL);

                /**
                 * Clear all environment variables
                 * @return status of operation
                 */
                status_t    clear_env();

            public:
                /**
                 * Return redirected standard input stream of the process.
                 * The redirection is allowed before successful launch() has been issued.
                 *
                 * @return pointer to standard input stream
                 */
                io::IOutStream *get_stdin();

                /**
                 * Return redirected standard output stream of the process.
                 * The redirection is allowed before successful launch() has been issued.
                 *
                 * @return pointer to standard output stream
                 */
                io::IInStream *get_stdout();

                /**
                 * Return redirected standard error stream of the process.
                 * The redirection is allowed before successful launch() has been issued.
                 *
                 * @return pointer to standard error stream
                 */
                io::IInStream *get_stderr();

                /**
                 * Get process status
                 * @return process status
                 */
                size_t      status();

                /**
                 * Copy environment variables of the current process
                 * @return status of operation
                 */
                status_t    copy_env();

                /**
                 * Launch the process
                 * @return status of operation
                 */
                status_t    launch();

                /**
                 * Chech that the object is not in error state
                 * @return true if object is in not error state
                 */
                bool        valid();

                /**
                 * Check that process is in running state
                 * @return true if process is in running state
                 */
                bool        running();

                /**
                 * Check that process has exited
                 * @return true if process has exited
                 */
                bool        exited();

                /**
                 * Get unique process identifier
                 * @return process identifier
                 */
                ssize_t     process_id() const;

                /**
                 * Wait for the process termination
                 * @param millis number of milliseconds to wait, negative value means infinite wait
                 * @return status of operation
                 */
                status_t    wait(wssize_t millis = -1);

                /**
                 * Get process exit status
                 * @param code pointer to save exit status
                 * @return status of operation
                 */
                status_t    exit_code(int *code);
        };
    
    } /* namespace ipc */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_IPC_PROCESS_H_ */
