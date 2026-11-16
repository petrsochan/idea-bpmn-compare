package com.github.bpmncompare;

import org.jetbrains.annotations.Nullable;

/**
 * One commit of a file's history and the blob ids of the file around it.
 *
 * <p>{@code beforeBlob} is the file in the commit's first parent, so a commit made on a side branch is
 * compared with what it changed, not with whatever the log happens to list next to it.
 *
 * @param beforeBlob {@code null} when the commit created the file
 * @param afterBlob  {@code null} when the commit deleted the file
 */
record HistoryCommit(String hash, String shortHash, String date, String author, String subject,
                     @Nullable String beforeBlob, @Nullable String afterBlob) {
}
